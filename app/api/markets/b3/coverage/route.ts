import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type SecurityRow = {
  codeCVM: string;
  ticker: string;
  tradingName: string;
  companyName: string;
};

type PriceRow = {
  ticker: string;
  price: number | null;
};

type ShareRow = {
  ticker: string;
  sharesOutstanding: number;
};

type FundamentalRow = {
  codeCVM: string;
};

type ValuationRow = {
  codeCVM: string;
  status: string;
};

type IrCheckRow = {
  codeCVM: string;
  status: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");

const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const PRICES_FILE = path.join(B3_DIR, "prices.json");
const SHARES_FILE = path.join(B3_DIR, "shares.json");
const FUNDAMENTALS_FILE = path.join(B3_DIR, "fundamentals.json");
const VALUATIONS_FILE = path.join(B3_DIR, "valuations.json");
const IR_CHECKS_FILE = path.join(B3_DIR, "ir-checks.json");

async function readJsonOrDefault(filePath: string, fallback: unknown) {
  try {
    const file = await fs.readFile(filePath, "utf-8");
    return JSON.parse(file);
  } catch {
    return fallback;
  }
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export async function GET() {
  const securitiesCache: any = await readJsonOrDefault(SECURITIES_FILE, {
    securities: [],
  });

  const pricesCache: any = await readJsonOrDefault(PRICES_FILE, {
    prices: [],
  });

  const sharesCache: any = await readJsonOrDefault(SHARES_FILE, {
    shares: [],
  });

  const fundamentalsCache: any = await readJsonOrDefault(FUNDAMENTALS_FILE, {
    fundamentals: [],
  });

  const valuationsCache: any = await readJsonOrDefault(VALUATIONS_FILE, {
    valuations: [],
  });

  const irChecksCache: any = await readJsonOrDefault(IR_CHECKS_FILE, {
    checks: [],
  });

  const securities: SecurityRow[] = securitiesCache.securities ?? [];
  const prices: PriceRow[] = pricesCache.prices ?? [];
  const shares: ShareRow[] = sharesCache.shares ?? [];
  const fundamentals: FundamentalRow[] = fundamentalsCache.fundamentals ?? [];
  const valuations: ValuationRow[] = valuationsCache.valuations ?? [];
  const irChecks: IrCheckRow[] = irChecksCache.checks ?? [];

  const companyCodes = unique(securities.map((item) => item.codeCVM));

  const pricedTickers = new Set(
    prices
      .filter((item) => typeof item.price === "number")
      .map((item) => item.ticker)
  );

  const tickersWithShares = new Set(
    shares
      .filter((item) => typeof item.sharesOutstanding === "number")
      .map((item) => item.ticker)
  );

  const companiesWithFundamentals = new Set(
    fundamentals.map((item) => item.codeCVM)
  );

  const valuedCompanies = new Set(
    valuations
      .filter((item) => item.status === "valued")
      .map((item) => item.codeCVM)
  );

  const companiesWithIrChecks = new Set(irChecks.map((item) => item.codeCVM));

  const missingPrice = securities.filter(
    (security) => !pricedTickers.has(security.ticker)
  );

  const missingShares = securities.filter(
    (security) => !tickersWithShares.has(security.ticker)
  );

  const missingFundamentals = companyCodes.filter(
    (codeCVM) => !companiesWithFundamentals.has(codeCVM)
  );

  const missingIrChecks = companyCodes.filter(
    (codeCVM) => !companiesWithIrChecks.has(codeCVM)
  );

  const securitiesByCodeCVM = new Map<string, SecurityRow[]>();

  for (const security of securities) {
    if (!securitiesByCodeCVM.has(security.codeCVM)) {
      securitiesByCodeCVM.set(security.codeCVM, []);
    }

    securitiesByCodeCVM.get(security.codeCVM)!.push(security);
  }

  const missingFundamentalsDetails = missingFundamentals.map((codeCVM) => {
    const companySecurities = securitiesByCodeCVM.get(codeCVM) ?? [];

    return {
      codeCVM,
      tradingName: companySecurities[0]?.tradingName ?? "",
      companyName: companySecurities[0]?.companyName ?? "",
      tickers: companySecurities.map((item) => item.ticker),
    };
  });

  const payload = {
    source: "InvestorPro",
    market: "b3",
    updatedAt: new Date().toISOString(),

    totals: {
      securities: securities.length,
      companies: companyCodes.length,
    },

    coverage: {
      pricedSecurities: pricedTickers.size,
      securitiesWithShares: tickersWithShares.size,
      companiesWithFundamentals: companiesWithFundamentals.size,
      valuedCompanies: valuedCompanies.size,
      companiesWithIrChecks: companiesWithIrChecks.size,
    },

    missing: {
      prices: missingPrice.length,
      shares: missingShares.length,
      fundamentals: missingFundamentals.length,
      irChecks: missingIrChecks.length,
    },

    samples: {
      missingPrice: missingPrice.slice(0, 25).map((item) => ({
        ticker: item.ticker,
        tradingName: item.tradingName,
        companyName: item.companyName,
        codeCVM: item.codeCVM,
      })),

      missingShares: missingShares.slice(0, 25).map((item) => ({
        ticker: item.ticker,
        tradingName: item.tradingName,
        companyName: item.companyName,
        codeCVM: item.codeCVM,
      })),

      missingFundamentals: missingFundamentalsDetails.slice(0, 25),

      missingIrChecks: missingIrChecks.slice(0, 25),
    },
  };

  return NextResponse.json(payload);
}
