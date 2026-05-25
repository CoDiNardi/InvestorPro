import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type PriceRow = {
  ticker: string;
  price: number | null;
};

type ShareRow = {
  ticker: string;
  sharesOutstanding: number;
};

type SecurityRow = {
  codeCVM: string;
  ticker: string;
  tradingName: string;
  companyName: string;
};

type FundamentalRow = {
  codeCVM: string;
  year: number;
  currency: string;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
};

type ProjectionModelResult = {
  model: string;
  pvOperatingCashFlow: number | null;
  pvRatio: number | null;
  evAdjustedPvRatio: number | null;
  note?: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");

const PRICES_FILE = path.join(B3_DIR, "prices.json");
const SHARES_FILE = path.join(B3_DIR, "shares.json");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const FUNDAMENTALS_FILE = path.join(B3_DIR, "fundamentals.json");
const VALUATIONS_FILE = path.join(B3_DIR, "valuations.json");

const DEFAULT_DISCOUNT_RATE = 0.12;
const DEFAULT_PROJECTION_YEARS = 10;
const MAX_EXPONENTIAL_GROWTH = 0.15;
const MIN_EXPONENTIAL_GROWTH = -0.15;

async function readJson(filePath: string) {
  const file = await fs.readFile(filePath, "utf-8");
  return JSON.parse(file);
}

function presentValue(cashFlows: number[], discountRate: number) {
  return cashFlows.reduce((sum, cashFlow, index) => {
    const year = index + 1;
    return sum + cashFlow / Math.pow(1 + discountRate, year);
  }, 0);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function standardDeviation(values: number[]) {
  const avg = average(values);

  if (avg === null || values.length < 2) return 0;

  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function calculateLinearProjection(valuesOldestToNewest: number[], years: number) {
  const n = valuesOldestToNewest.length;

  if (n < 2) return null;

  const xValues = valuesOldestToNewest.map((_, index) => index + 1);
  const yValues = valuesOldestToNewest;

  const xAvg = average(xValues)!;
  const yAvg = average(yValues)!;

  const numerator = xValues.reduce(
    (sum, x, index) => sum + (x - xAvg) * (yValues[index] - yAvg),
    0
  );

  const denominator = xValues.reduce((sum, x) => sum + Math.pow(x - xAvg, 2), 0);

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = yAvg - slope * xAvg;

  const projected = [];

  for (let i = 1; i <= years; i++) {
    const nextX = n + i;
    projected.push(Math.max(0, intercept + slope * nextX));
  }

  return projected;
}

function calculateExponentialProjection(
  valuesOldestToNewest: number[],
  years: number
) {
  const positiveValues = valuesOldestToNewest.filter((value) => value > 0);

  if (positiveValues.length < 2) return null;

  const first = positiveValues[0];
  const last = positiveValues[positiveValues.length - 1];
  const periods = positiveValues.length - 1;

  if (first <= 0 || last <= 0 || periods <= 0) return null;

  const rawGrowth = Math.pow(last / first, 1 / periods) - 1;
  const growth = clamp(rawGrowth, MIN_EXPONENTIAL_GROWTH, MAX_EXPONENTIAL_GROWTH);

  const projected = [];

  for (let i = 1; i <= years; i++) {
    projected.push(last * Math.pow(1 + growth, i));
  }

  return {
    growth,
    projected,
  };
}

function buildModelResult(
  model: string,
  projectedCashFlows: number[] | null,
  marketCap: number,
  enterpriseValue: number,
  discountRate: number,
  note?: string
): ProjectionModelResult {
  if (!projectedCashFlows || projectedCashFlows.length === 0) {
    return {
      model,
      pvOperatingCashFlow: null,
      pvRatio: null,
      evAdjustedPvRatio: null,
      note: note ?? "Insufficient data",
    };
  }

  const pvOperatingCashFlow = presentValue(projectedCashFlows, discountRate);

  return {
    model,
    pvOperatingCashFlow,
    pvRatio: marketCap > 0 ? pvOperatingCashFlow / marketCap : null,
    evAdjustedPvRatio:
      enterpriseValue > 0 ? pvOperatingCashFlow / enterpriseValue : null,
    note,
  };
}

function chooseSelectedModel(args: {
  ocfValuesNewestToOldest: number[];
  stable: ProjectionModelResult;
  linear: ProjectionModelResult;
  exponential: ProjectionModelResult;
  cyclical: ProjectionModelResult;
}) {
  const { ocfValuesNewestToOldest, stable, linear, exponential, cyclical } = args;

  const avg = average(ocfValuesNewestToOldest);
  const sd = standardDeviation(ocfValuesNewestToOldest);
  const volatility = avg && avg !== 0 ? Math.abs(sd / avg) : Infinity;
  const negativeYears = ocfValuesNewestToOldest.filter((value) => value <= 0).length;

  if (negativeYears > 0) {
    return {
      selectedModel: "cyclical_ocf",
      selected: cyclical,
      confidence: "low",
      reason: "Cash flow has negative or zero years; cyclical/normalized model is safer.",
    };
  }

  if (volatility > 0.35) {
    return {
      selectedModel: "cyclical_ocf",
      selected: cyclical,
      confidence: "medium",
      reason: "High cash-flow volatility; median cycle cash flow is safer.",
    };
  }

  if (
    typeof linear.pvRatio === "number" &&
    typeof stable.pvRatio === "number" &&
    linear.pvRatio > stable.pvRatio * 0.8 &&
    linear.pvRatio < stable.pvRatio * 1.5
  ) {
    return {
      selectedModel: "linear_ocf",
      selected: linear,
      confidence: "medium",
      reason: "Linear projection is close to stable projection and cash-flow volatility is acceptable.",
    };
  }

  if (
    typeof exponential.pvRatio === "number" &&
    typeof stable.pvRatio === "number" &&
    exponential.pvRatio > stable.pvRatio * 0.8 &&
    exponential.pvRatio < stable.pvRatio * 1.75
  ) {
    return {
      selectedModel: "exponential_ocf",
      selected: exponential,
      confidence: "medium",
      reason: "Exponential projection is not excessively far from stable projection.",
    };
  }

  return {
    selectedModel: "stable_ocf",
    selected: stable,
    confidence: "medium",
    reason: "Stable normalized operating cash flow is the conservative default.",
  };
}

export async function POST() {
  try {
    const pricesCache = await readJson(PRICES_FILE);
    const sharesCache = await readJson(SHARES_FILE);
    const securitiesCache = await readJson(SECURITIES_FILE);
    const fundamentalsCache = await readJson(FUNDAMENTALS_FILE);

    const prices: PriceRow[] = pricesCache.prices ?? [];
    const shares: ShareRow[] = sharesCache.shares ?? [];
    const securities: SecurityRow[] = securitiesCache.securities ?? [];
    const fundamentals: FundamentalRow[] = fundamentalsCache.fundamentals ?? [];

    const priceByTicker = new Map(prices.map((row) => [row.ticker, row]));
    const sharesByTicker = new Map(shares.map((row) => [row.ticker, row]));

    const securitiesByCodeCVM = new Map<string, SecurityRow[]>();

    for (const security of securities) {
      if (!securitiesByCodeCVM.has(security.codeCVM)) {
        securitiesByCodeCVM.set(security.codeCVM, []);
      }

      securitiesByCodeCVM.get(security.codeCVM)!.push(security);
    }

    const fundamentalsByCodeCVM = new Map<string, FundamentalRow[]>();

    for (const row of fundamentals) {
      if (!fundamentalsByCodeCVM.has(row.codeCVM)) {
        fundamentalsByCodeCVM.set(row.codeCVM, []);
      }

      fundamentalsByCodeCVM.get(row.codeCVM)!.push(row);
    }

    const valuations = [];

    for (const [codeCVM, companyFundamentals] of fundamentalsByCodeCVM) {
      const companySecurities = securitiesByCodeCVM.get(codeCVM) ?? [];

      const tickerMarketCaps = [];

      for (const security of companySecurities) {
        const price = priceByTicker.get(security.ticker)?.price;
        const sharesOutstanding = sharesByTicker.get(
          security.ticker
        )?.sharesOutstanding;

        if (
          typeof price !== "number" ||
          typeof sharesOutstanding !== "number"
        ) {
          continue;
        }

        tickerMarketCaps.push({
          ticker: security.ticker,
          price,
          sharesOutstanding,
          marketCap: price * sharesOutstanding,
        });
      }

      const marketCap = tickerMarketCaps.reduce(
        (sum, row) => sum + row.marketCap,
        0
      );

      if (marketCap <= 0) {
        valuations.push({
          codeCVM,
          status: "missing_market_cap",
          reason: "No ticker with both price and shares outstanding",
        });
        continue;
      }

      const sortedFundamentals = [...companyFundamentals].sort(
        (a, b) => b.year - a.year
      );

      const ocfValuesNewestToOldest = sortedFundamentals
        .map((row) => row.operatingCashFlow)
        .filter((value): value is number => typeof value === "number");

      const ocfValuesOldestToNewest = [...ocfValuesNewestToOldest].reverse();

      const normalizedOperatingCashFlow = average(ocfValuesNewestToOldest);
      const medianOperatingCashFlow = median(ocfValuesNewestToOldest);

      if (
        typeof normalizedOperatingCashFlow !== "number" ||
        normalizedOperatingCashFlow <= 0
      ) {
        valuations.push({
          codeCVM,
          status: "missing_cash_flow",
          reason: "No positive operating cash flow history",
          marketCap,
          tickerMarketCaps,
        });
        continue;
      }

      const latestFundamental = sortedFundamentals[0];

      const totalDebt = latestFundamental.totalDebt ?? 0;
      const cashAndEquivalents = latestFundamental.cashAndEquivalents ?? 0;
      const netDebt = totalDebt - cashAndEquivalents;
      const enterpriseValue = marketCap + netDebt;

      const stableCashFlows = Array(DEFAULT_PROJECTION_YEARS).fill(
        normalizedOperatingCashFlow
      );

      const cyclicalCashFlows = Array(DEFAULT_PROJECTION_YEARS).fill(
        medianOperatingCashFlow ?? normalizedOperatingCashFlow
      );

      const linearCashFlows = calculateLinearProjection(
        ocfValuesOldestToNewest,
        DEFAULT_PROJECTION_YEARS
      );

      const exponentialProjection = calculateExponentialProjection(
        ocfValuesOldestToNewest,
        DEFAULT_PROJECTION_YEARS
      );

      const stable = buildModelResult(
        "stable_ocf",
        stableCashFlows,
        marketCap,
        enterpriseValue,
        DEFAULT_DISCOUNT_RATE,
        "Average historical operating cash flow."
      );

      const cyclical = buildModelResult(
        "cyclical_ocf",
        cyclicalCashFlows,
        marketCap,
        enterpriseValue,
        DEFAULT_DISCOUNT_RATE,
        "Median historical operating cash flow."
      );

      const linear = buildModelResult(
        "linear_ocf",
        linearCashFlows,
        marketCap,
        enterpriseValue,
        DEFAULT_DISCOUNT_RATE,
        "Linear trend on historical operating cash flow."
      );

      const exponential = buildModelResult(
        "exponential_ocf",
        exponentialProjection?.projected ?? null,
        marketCap,
        enterpriseValue,
        DEFAULT_DISCOUNT_RATE,
        exponentialProjection
          ? `Capped CAGR projection. Growth used: ${(exponentialProjection.growth * 100).toFixed(2)}%.`
          : "Insufficient positive cash-flow history."
      );

      const selected = chooseSelectedModel({
        ocfValuesNewestToOldest,
        stable,
        linear,
        exponential,
        cyclical,
      });

      valuations.push({
        codeCVM,
        status: "valued",
        selectedModel: selected.selectedModel,
        model: selected.selectedModel,
        confidence: selected.confidence,
        reason: selected.reason,
        discountRate: DEFAULT_DISCOUNT_RATE,
        projectionYears: DEFAULT_PROJECTION_YEARS,
        tradingName: companySecurities[0]?.tradingName ?? "",
        companyName: companySecurities[0]?.companyName ?? "",
        currency: latestFundamental.currency,
        yearsAvailable: ocfValuesNewestToOldest.length,
        latestYear: latestFundamental.year,
        normalizedOperatingCashFlow,
        medianOperatingCashFlow,
        latestOperatingCashFlow: latestFundamental.operatingCashFlow,
        latestFreeCashFlow: latestFundamental.freeCashFlow,
        totalDebt,
        cashAndEquivalents,
        netDebt,
        marketCap,
        enterpriseValue,

        pvOperatingCashFlow: selected.selected.pvOperatingCashFlow,
        pvRatio: selected.selected.pvRatio,
        evAdjustedPvRatio: selected.selected.evAdjustedPvRatio,

        stablePvRatio: stable.pvRatio,
        linearPvRatio: linear.pvRatio,
        exponentialPvRatio: exponential.pvRatio,
        cyclicalPvRatio: cyclical.pvRatio,

        stableEvAdjustedPvRatio: stable.evAdjustedPvRatio,
        linearEvAdjustedPvRatio: linear.evAdjustedPvRatio,
        exponentialEvAdjustedPvRatio: exponential.evAdjustedPvRatio,
        cyclicalEvAdjustedPvRatio: cyclical.evAdjustedPvRatio,

        modelResults: {
          stable,
          linear,
          exponential,
          cyclical,
        },

        tickerMarketCaps,
      });
    }

    const payload = {
      source: "InvestorPro",
      market: "b3",
      updatedAt: new Date().toISOString(),
      model: "multi_model_ocf",
      discountRate: DEFAULT_DISCOUNT_RATE,
      projectionYears: DEFAULT_PROJECTION_YEARS,
      count: valuations.length,
      valuedCount: valuations.filter((item) => item.status === "valued").length,
      valuations,
    };

    await fs.writeFile(
      VALUATIONS_FILE,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not calculate B3 valuations",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
