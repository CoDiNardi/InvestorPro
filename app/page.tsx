"use client";

import { useEffect, useMemo, useState } from "react";

type Company = {
  codeCVM: string;
  issuingCompany: string;
  companyName: string;
  tradingName: string;
  cnpj: string;
  marketIndicator: string;
  typeBDR: string;
  dateListing: string;
  status: string;
  segment: string;
};

type CompaniesResponse = {
  source: string;
  market: string;
  updatedAt: string | null;
  count: number;
  companies: Company[];
};

type SecurityCode = {
  code: string;
  isin?: string;
};

type DetailData = {
  code?: string;
  otherCodes?: SecurityCode[];
  website?: string;
  hasQuotation?: string;
  market?: string;
  activity?: string;
  industryClassification?: string;
};

type CompanyDetailRecord = {
  codeCVM: string;
  companyName: string;
  tradingName: string;
  cnpj: string;
  marketIndicator: string;
  segment: string;
  detail?: DetailData;
  error?: string;
};

type CompanyDetailsResponse = {
  source: string;
  market: string;
  updatedAt: string | null;
  count: number;
  successCount: number;
  errorCount: number;
  details: CompanyDetailRecord[];
};

type Security = {
  market: string;
  codeCVM: string;
  companyName: string;
  tradingName: string;
  cnpj: string;
  ticker: string;
  isin: string;
  shareClass: string;
  mainTicker: string;
  website: string;
  hasQuotation: string;
  b3Market: string;
  segment: string;
  industryClassification: string;
  activity: string;
};

type SecuritiesResponse = {
  source: string;
  market: string;
  updatedAt: string | null;
  count: number;
  securities: Security[];
};

type PriceRow = {
  market: string;
  ticker: string;
  isin: string;
  shareClass: string;
  codeCVM: string;
  companyName: string;
  tradingName: string;
  currency: string;
  price: number | null;
  priceUpdatedAt: string | null;
  source: string;
};

type PricesResponse = {
  source: string;
  market: string;
  updatedAt: string | null;
  count: number;
  prices: PriceRow[];
};

type ValuationRow = {
  codeCVM: string;
  status: string;
  model?: string;
  selectedModel?: string;
  confidence?: string;
  stablePvRatio?: number | null;
  linearPvRatio?: number | null;
  exponentialPvRatio?: number | null;
  cyclicalPvRatio?: number | null;
  tradingName?: string;
  companyName?: string;
  currency?: string;
  marketCap?: number;
  enterpriseValue?: number;
  pvOperatingCashFlow?: number;
  pvRatio?: number;
  evAdjustedPvRatio?: number;
};

type ValuationsResponse = {
  source: string;
  market: string;
  updatedAt: string | null;
  model: string;
  count: number;
  valuedCount: number;
  valuations: ValuationRow[];
};

const LIKELY_OPERATING_COMPANY_MARKET_INDICATORS = ["16", "17", "18"];

const MARKET_LABELS: Record<string, string> = {
  "1": "Mixed / Other Listed Instruments",
  "7": "Special / Legacy Group",
  "8": "Issuer / Debt-Oriented Group",
  "14": "BDRs / Foreign Companies",
  "16": "Operating Companies Group 16",
  "17": "Operating Companies Group 17",
  "18": "Operating Companies Group 18",
  "99": "Unclassified / Non-Standard Issuers",
};

function getMarketLabel(marketIndicator: string) {
  if (!marketIndicator) return "-";
  return MARKET_LABELS[marketIndicator] ?? `Market ${marketIndicator}`;
}

function isLikelyEquityTicker(code: string) {
  return /^[A-Z0-9]{4}(3|4|5|6|11)$/.test(code);
}

function getEquityTickers(detail?: DetailData) {
  const codes = detail?.otherCodes ?? [];
  return codes.map((item) => item.code).filter(isLikelyEquityTicker);
}

function normalizeWebsiteUrl(value?: string) {
  if (!value) return "";

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `https://${value}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Never updated";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTimeSince(value: string | null, now: Date) {
  if (!value) return "No update yet";

  const updatedAt = new Date(value);
  const diffMs = now.getTime() - updatedAt.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatRatio(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function formatModelName(value?: string) {
  if (!value) return "-";

  return value
    .replace("_ocf", "")
    .replace("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniqueCompanyValues(companies: Company[], key: keyof Company) {
  return Array.from(
    new Set(
      companies
        .map((company) => company[key])
        .filter((value) => value && value.trim().length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function uniqueSecurityValues(securities: Security[], key: keyof Security) {
  return Array.from(
    new Set(
      securities
        .map((security) => String(security[key] ?? ""))
        .filter((value) => value && value.trim().length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export default function Home() {
  const [viewMode, setViewMode] = useState<"issuers" | "securities">("securities");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [details, setDetails] = useState<CompanyDetailRecord[]>([]);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);

  const [companiesUpdatedAt, setCompaniesUpdatedAt] = useState<string | null>(
    null
  );
  const [detailsUpdatedAt, setDetailsUpdatedAt] = useState<string | null>(null);
  const [securitiesUpdatedAt, setSecuritiesUpdatedAt] = useState<string | null>(
    null
  );
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<string | null>(null);
  const [valuationsUpdatedAt, setValuationsUpdatedAt] = useState<string | null>(
    null
  );

  const [query, setQuery] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [marketIndicatorFilter, setMarketIndicatorFilter] = useState("");
  const [typeBdrFilter, setTypeBdrFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [shareClassFilter, setShareClassFilter] = useState("");
  const [valuedOnly, setValuedOnly] = useState(false);
  const [sortMode, setSortMode] = useState("ticker_asc");
  const [likelyOperatingCompaniesOnly, setLikelyOperatingCompaniesOnly] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [updatingCompanies, setUpdatingCompanies] = useState(false);
  const [updatingDetails, setUpdatingDetails] = useState(false);
  const [updatingSecurities, setUpdatingSecurities] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());

  async function loadCompanies() {
    const response = await fetch("/api/markets/b3/companies", {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Failed to load local B3 cache");

    const data: CompaniesResponse = await response.json();

    setCompanies(data.companies ?? []);
    setCompaniesUpdatedAt(data.updatedAt ?? null);
  }

  async function loadCompanyDetails() {
    const response = await fetch("/api/markets/b3/company-details", {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Failed to load local B3 company details");

    const data: CompanyDetailsResponse = await response.json();

    setDetails(data.details ?? []);
    setDetailsUpdatedAt(data.updatedAt ?? null);
  }

  async function loadSecurities() {
    const response = await fetch("/api/markets/b3/securities", {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Failed to load local B3 securities");

    const data: SecuritiesResponse = await response.json();

    setSecurities(data.securities ?? []);
    setSecuritiesUpdatedAt(data.updatedAt ?? null);
  }

  async function loadPrices() {
    const response = await fetch("/api/markets/b3/prices", {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Failed to load local B3 prices");

    const data: PricesResponse = await response.json();

    setPrices(data.prices ?? []);
    setPricesUpdatedAt(data.updatedAt ?? null);
  }

  async function loadValuations() {
    const response = await fetch("/api/markets/b3/valuations", {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Failed to load local B3 valuations");

    const data: ValuationsResponse = await response.json();

    setValuations(data.valuations ?? []);
    setValuationsUpdatedAt(data.updatedAt ?? null);
  }

  async function updateCompanies() {
    try {
      setUpdatingCompanies(true);
      setError("");

      const response = await fetch("/api/markets/b3/companies/update", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to update B3 universe");

      await loadCompanies();
      setNow(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingCompanies(false);
    }
  }

  async function updateCompanyDetails() {
    try {
      setUpdatingDetails(true);
      setError("");

      const response = await fetch("/api/markets/b3/company-details/update", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to update B3 company details");

      await loadCompanyDetails();
      setNow(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingDetails(false);
    }
  }

  async function updateSecurities() {
    try {
      setUpdatingSecurities(true);
      setError("");

      const response = await fetch("/api/markets/b3/securities/update", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to update B3 securities");

      await loadSecurities();
      setNow(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingSecurities(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setSegmentFilter("");
    setMarketIndicatorFilter("");
    setTypeBdrFilter("");
    setStatusFilter("");
    setShareClassFilter("");
    setValuedOnly(false);
    setSortMode("ticker_asc");
    setLikelyOperatingCompaniesOnly(false);
  }

  function enableLikelyOperatingCompaniesOnly() {
    setLikelyOperatingCompaniesOnly(true);
    setMarketIndicatorFilter("");
    setTypeBdrFilter("");
  }

  useEffect(() => {
    async function start() {
      try {
        setError("");
        await Promise.all([loadCompanies(), loadCompanyDetails(), loadSecurities(), loadPrices(), loadValuations()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    start();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const detailsByCodeCVM = useMemo(() => {
    const map = new Map<string, CompanyDetailRecord>();
    for (const item of details) map.set(item.codeCVM, item);
    return map;
  }, [details]);

  const segmentOptions = useMemo(
    () => uniqueCompanyValues(companies, "segment"),
    [companies]
  );

  const marketIndicatorOptions = useMemo(
    () => uniqueCompanyValues(companies, "marketIndicator"),
    [companies]
  );

  const typeBdrOptions = useMemo(
    () => uniqueCompanyValues(companies, "typeBDR"),
    [companies]
  );

  const statusOptions = useMemo(
    () => uniqueCompanyValues(companies, "status"),
    [companies]
  );

  const shareClassOptions = useMemo(
    () => uniqueSecurityValues(securities, "shareClass"),
    [securities]
  );

  const likelyOperatingCompaniesCount = useMemo(() => {
    return companies.filter((company) =>
      LIKELY_OPERATING_COMPANY_MARKET_INDICATORS.includes(
        company.marketIndicator
      )
    ).length;
  }, [companies]);

  const companiesWithEquityTickersCount = useMemo(() => {
    return details.filter((item) => getEquityTickers(item.detail).length > 0)
      .length;
  }, [details]);

  const pricesByTicker = useMemo(() => {
    const map = new Map<string, PriceRow>();
    for (const item of prices) map.set(item.ticker, item);
    return map;
  }, [prices]);

  const pricedSecuritiesCount = useMemo(() => {
    return prices.filter((item) => typeof item.price === "number").length;
  }, [prices]);

  const valuationsByCodeCVM = useMemo(() => {
    const map = new Map<string, ValuationRow>();
    for (const item of valuations) map.set(item.codeCVM, item);
    return map;
  }, [valuations]);

  const valuedCompaniesCount = useMemo(() => {
    return valuations.filter((item) => item.status === "valued").length;
  }, [valuations]);

  const filteredCompanies = useMemo(() => {
    const q = query.toLowerCase().trim();

    return companies.filter((company) => {
      const detailRecord = detailsByCodeCVM.get(company.codeCVM);
      const detail = detailRecord?.detail;
      const equityTickers = getEquityTickers(detail);

      const matchesQuery =
        !q ||
        [
          company.codeCVM,
          company.issuingCompany,
          company.companyName,
          company.tradingName,
          company.cnpj,
          company.segment,
          company.marketIndicator,
          getMarketLabel(company.marketIndicator),
          company.typeBDR,
          company.status,
          detail?.code,
          equityTickers.join(" "),
          detail?.website,
          detail?.market,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesSegment =
        !segmentFilter || company.segment === segmentFilter;

      const matchesMarketIndicator =
        !marketIndicatorFilter ||
        company.marketIndicator === marketIndicatorFilter;

      const matchesTypeBdr =
        !typeBdrFilter || company.typeBDR === typeBdrFilter;

      const matchesStatus = !statusFilter || company.status === statusFilter;

      const matchesLikelyOperatingCompanyMode =
        !likelyOperatingCompaniesOnly ||
        LIKELY_OPERATING_COMPANY_MARKET_INDICATORS.includes(
          company.marketIndicator
        );

      return (
        matchesQuery &&
        matchesSegment &&
        matchesMarketIndicator &&
        matchesTypeBdr &&
        matchesStatus &&
        matchesLikelyOperatingCompanyMode
      );
    });
  }, [
    companies,
    detailsByCodeCVM,
    query,
    segmentFilter,
    marketIndicatorFilter,
    typeBdrFilter,
    statusFilter,
    likelyOperatingCompaniesOnly,
  ]);

  const filteredSecurities = useMemo(() => {
    const q = query.toLowerCase().trim();

    return securities
      .filter((security) => {
      const valuation = valuationsByCodeCVM.get(security.codeCVM);

      const matchesQuery =
        !q ||
        [
          security.codeCVM,
          security.companyName,
          security.tradingName,
          security.cnpj,
          security.ticker,
          security.isin,
          security.shareClass,
          security.mainTicker,
          security.website,
          security.hasQuotation,
          security.b3Market,
          security.segment,
          security.industryClassification,
          String(pricesByTicker.get(security.ticker)?.price ?? ""),
          pricesByTicker.get(security.ticker)?.currency,
          String(valuation?.pvRatio ?? ""),
          String(valuation?.evAdjustedPvRatio ?? ""),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesSegment =
        !segmentFilter || security.segment === segmentFilter;

      const matchesShareClass =
        !shareClassFilter ||
    valuedOnly ||
    sortMode !== "ticker_asc" || security.shareClass === shareClassFilter;

      const matchesValuedOnly =
        !valuedOnly || valuationsByCodeCVM.get(security.codeCVM)?.status === "valued";

      return matchesQuery && matchesSegment && matchesShareClass && matchesValuedOnly;
    })
      .sort((a, b) => {
        const valuationA = valuationsByCodeCVM.get(a.codeCVM);
        const valuationB = valuationsByCodeCVM.get(b.codeCVM);
        const priceA = pricesByTicker.get(a.ticker)?.price;
        const priceB = pricesByTicker.get(b.ticker)?.price;

        if (sortMode === "pv_desc") {
          return (valuationB?.pvRatio ?? -Infinity) - (valuationA?.pvRatio ?? -Infinity);
        }

        if (sortMode === "ev_pv_desc") {
          return (
            (valuationB?.evAdjustedPvRatio ?? -Infinity) -
            (valuationA?.evAdjustedPvRatio ?? -Infinity)
          );
        }

        if (sortMode === "price_desc") {
          return (priceB ?? -Infinity) - (priceA ?? -Infinity);
        }

        if (sortMode === "price_asc") {
          return (priceA ?? Infinity) - (priceB ?? Infinity);
        }

        return a.ticker.localeCompare(b.ticker);
      });
  }, [securities, query, segmentFilter, shareClassFilter, valuedOnly, sortMode, pricesByTicker, valuationsByCodeCVM]);

  const hasActiveFilters =
    query ||
    segmentFilter ||
    marketIndicatorFilter ||
    typeBdrFilter ||
    statusFilter ||
    shareClassFilter ||
    valuedOnly ||
    sortMode !== "ticker_asc" ||
    likelyOperatingCompaniesOnly;

  const activeDenominator =
    viewMode === "issuers"
      ? likelyOperatingCompaniesOnly
        ? likelyOperatingCompaniesCount
        : companies.length
      : securities.length;

  const activeCount =
    viewMode === "issuers" ? filteredCompanies.length : filteredSecurities.length;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-slate-400">
            InvestorPro
          </p>

          <h1 className="text-4xl font-bold mt-2">B3 Market Universe</h1>

          <p className="text-slate-400 mt-3 max-w-3xl">
            Local B3 investing universe with companies, investable tickers, share classes, prices, websites, and quotation status.
          </p>
        </header>

        <section className="mb-6 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <button
              onClick={() => setViewMode("issuers")}
              className={`rounded-xl px-5 py-3 font-semibold ${
                viewMode === "issuers"
                  ? "bg-blue-600 text-white"
                  : "border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
              }`}
            >
              Companies / Issuers
            </button>

            <button
              onClick={() => setViewMode("securities")}
              className={`rounded-xl px-5 py-3 font-semibold ${
                viewMode === "securities"
                  ? "bg-blue-600 text-white"
                  : "border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
              }`}
            >
              Investable Securities
            </button>
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by company, ticker, trading name, CVM code, CNPJ, segment..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
          />

          {viewMode === "issuers" && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <select
                value={segmentFilter}
                onChange={(event) => setSegmentFilter(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All segments</option>
                {segmentOptions.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))}
              </select>

              <select
                value={marketIndicatorFilter}
                onChange={(event) => {
                  setMarketIndicatorFilter(event.target.value);
                  setLikelyOperatingCompaniesOnly(false);
                }}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All market groups</option>
                {marketIndicatorOptions.map((marketIndicator) => (
                  <option key={marketIndicator} value={marketIndicator}>
                    {marketIndicator} - {getMarketLabel(marketIndicator)}
                  </option>
                ))}
              </select>

              <select
                value={typeBdrFilter}
                onChange={(event) => setTypeBdrFilter(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All BDR types</option>
                {typeBdrOptions.map((typeBdr) => (
                  <option key={typeBdr} value={typeBdr}>
                    {typeBdr}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          )}

          {viewMode === "securities" && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <select
                value={segmentFilter}
                onChange={(event) => setSegmentFilter(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All segments</option>
                {segmentOptions.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))}
              </select>

              <select
                value={shareClassFilter}
                onChange={(event) => setShareClassFilter(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="">All share classes</option>
                {shareClassOptions.map((shareClass) => (
                  <option key={shareClass} value={shareClass}>
                    {shareClass}
                  </option>
                ))}
              </select>

              <select
                value={valuedOnly ? "valued" : "all"}
                onChange={(event) => setValuedOnly(event.target.value === "valued")}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="all">All securities</option>
                <option value="valued">Valued only</option>
              </select>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-blue-500"
              >
                <option value="ticker_asc">Ticker A-Z</option>
                <option value="pv_desc">Highest PV Ratio</option>
                <option value="ev_pv_desc">Highest EV PV Ratio</option>
                <option value="price_desc">Highest Price</option>
                <option value="price_asc">Lowest Price</option>
              </select>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto]">
            <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-300">
              {activeCount} / {activeDenominator}{" "}
              {viewMode === "issuers" ? "records" : "securities"}
            </div>

            {viewMode === "issuers" && (
              <button
                onClick={enableLikelyOperatingCompaniesOnly}
                disabled={likelyOperatingCompaniesOnly}
                className="rounded-xl border border-emerald-700 bg-emerald-950 px-5 py-3 font-semibold text-emerald-100 hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Likely operating companies ({likelyOperatingCompaniesCount})
              </button>
            )}

            <button
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear filters
            </button>
          </div>

          {likelyOperatingCompaniesOnly && viewMode === "issuers" && (
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-100">
              Likely operating company mode is active. Current heuristic:
              market groups 16, 17, and 18.
            </div>
          )}
        </section>

                <section className="mb-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <details>
            <summary className="cursor-pointer font-semibold text-slate-100">
              Data maintenance
            </summary>

            <p className="mt-2 text-sm text-slate-400">
              Use these only when you want to refresh the local B3 data layers.
              Prices from CSV are imported automatically when the app loads prices.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <button
                onClick={updateCompanies}
                disabled={updatingCompanies}
                className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingCompanies ? "Updating universe..." : "Update B3 universe"}
              </button>

              <button
                onClick={updateCompanyDetails}
                disabled={updatingDetails}
                className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingDetails ? "Updating details..." : "Update details / tickers"}
              </button>

              <button
                onClick={updateSecurities}
                disabled={updatingSecurities}
                className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingSecurities ? "Updating securities..." : "Update securities"}
              </button>
            </div>
          </details>
        </section>
        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Universe last update</p>
            <p className="mt-1 font-medium">
              {formatDateTime(companiesUpdatedAt)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatTimeSince(companiesUpdatedAt, now)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Details last update</p>
            <p className="mt-1 font-medium">
              {formatDateTime(detailsUpdatedAt)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatTimeSince(detailsUpdatedAt, now)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Securities last update</p>
            <p className="mt-1 font-medium">
              {formatDateTime(securitiesUpdatedAt)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatTimeSince(securitiesUpdatedAt, now)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Likely operating companies</p>
            <p className="mt-1 font-medium">
              {likelyOperatingCompaniesCount} records
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Equity securities</p>
            <p className="mt-1 font-medium">{securities.length} tickers</p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Priced securities</p>
            <p className="mt-1 font-medium">
              {pricedSecuritiesCount} / {securities.length}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatTimeSince(pricesUpdatedAt, now)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Valued companies</p>
            <p className="mt-1 font-medium">{valuedCompaniesCount}</p>
            <p className="mt-1 text-sm text-slate-500">
              {formatTimeSince(valuationsUpdatedAt, now)}
            </p>
          </div>
        </section>

        {loading && (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
            Loading local cache...
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-700 bg-red-950 p-6 text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && viewMode === "issuers" && companies.length > 0 && (
          <div className="investorpro-table-wrapper rounded-xl border border-slate-700 bg-slate-900">
            <table className="investorpro-table w-full min-w-[1500px] text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="p-3 text-left">CVM</th>
                  <th className="p-3 text-left">Company</th>
                  <th className="p-3 text-left">Trading Name</th>
                  <th className="p-3 text-left">Main Ticker</th>
                  <th className="p-3 text-left">Equity Tickers</th>
                  <th className="p-3 text-left">Website</th>
                  <th className="p-3 text-left">Quotation</th>
                  <th className="p-3 text-left">Market</th>
                  <th className="p-3 text-left">Segment</th>
                  <th className="p-3 text-left">Market Group</th>
                  <th className="p-3 text-left">BDR</th>
                  <th className="p-3 text-left">Listing Date</th>
                </tr>
              </thead>

              <tbody>
                {filteredCompanies.map((company, index) => {
                  const detailRecord = detailsByCodeCVM.get(company.codeCVM);
                  const detail = detailRecord?.detail;
                  const equityTickers = getEquityTickers(detail);
                  const websiteUrl = normalizeWebsiteUrl(detail?.website);

                  return (
                    <tr
                      key={`${company.codeCVM}-${company.cnpj}-${index}`}
                      className="border-t border-slate-800 hover:bg-slate-800/60"
                    >
                      <td className="p-3 text-slate-400">{company.codeCVM || "-"}</td>
                      <td className="p-3 font-medium">
                        {company.companyName || company.issuingCompany || "-"}
                      </td>
                      <td className="p-3">{company.tradingName || "-"}</td>
                      <td className="p-3 font-semibold text-slate-100">
                        {detail?.code || "-"}
                      </td>
                      <td className="p-3 text-slate-300">
                        {equityTickers.length > 0 ? equityTickers.join(", ") : "-"}
                      </td>
                      <td className="p-3">
                        {websiteUrl ? (
                          <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300"
                          >
                            {detail?.website}
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400">{detail?.hasQuotation || "-"}</td>
                      <td className="p-3 text-slate-400">{detail?.market || "-"}</td>
                      <td className="p-3">{company.segment || "-"}</td>
                      <td className="p-3 text-slate-400">
                        {company.marketIndicator || "-"} - {getMarketLabel(company.marketIndicator)}
                      </td>
                      <td className="p-3 text-slate-400">{company.typeBDR || "-"}</td>
                      <td className="p-3 text-slate-400">{company.dateListing || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && viewMode === "securities" && (
          <div className="investorpro-table-wrapper rounded-xl border border-slate-700 bg-slate-900">
            <table className="investorpro-table w-full min-w-[1900px] text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="p-3 text-left">Ticker</th>
                  <th className="p-3 text-left">Share Class</th>
                  <th className="p-3 text-left">Price</th>
                  <th className="p-3 text-left">Currency</th>
                  <th className="p-3 text-left">PV Ratio</th>
                  <th className="p-3 text-left">EV PV Ratio</th>
                  <th className="p-3 text-left">Market Cap</th>
                  <th className="p-3 text-left">Model</th>
                  <th className="p-3 text-left">Confidence</th>
                  <th className="p-3 text-left">Stable PV</th>
                  <th className="p-3 text-left">Linear PV</th>
                  <th className="p-3 text-left">Exponential PV</th>
                  <th className="p-3 text-left">Cyclical PV</th>
                  <th className="p-3 text-left">Company</th>
                  <th className="p-3 text-left">Trading Name</th>
                  <th className="p-3 text-left">ISIN</th>
                  <th className="p-3 text-left">Main Ticker</th>
                  <th className="p-3 text-left">Website</th>
                  <th className="p-3 text-left">Quotation</th>
                  <th className="p-3 text-left">Market</th>
                  <th className="p-3 text-left">Segment</th>
                </tr>
              </thead>

              <tbody>
                {filteredSecurities.map((security, index) => {
                  const websiteUrl = normalizeWebsiteUrl(security.website);
                  const priceRow = pricesByTicker.get(security.ticker);
                  const valuation = valuationsByCodeCVM.get(security.codeCVM);

                  return (
                    <tr
                      key={`${security.ticker}-${security.isin}-${index}`}
                      className="border-t border-slate-800 hover:bg-slate-800/60"
                    >
                      <td className="p-3 font-bold text-slate-100">{security.ticker}</td>
                      <td className="p-3 text-slate-300">{security.shareClass}</td>
                      <td className="p-3 font-semibold text-slate-100">
                        {typeof priceRow?.price === "number"
                          ? priceRow.price.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "-"}
                      </td>
                      <td className="p-3 text-slate-400">
                        {priceRow?.currency || "-"}
                      </td>
                      <td className="p-3 font-semibold text-slate-100">
                        {typeof valuation?.pvRatio === "number"
                          ? valuation.pvRatio.toFixed(2)
                          : "-"}
                      </td>
                      <td className="p-3 text-slate-300">
                        {typeof valuation?.evAdjustedPvRatio === "number"
                          ? valuation.evAdjustedPvRatio.toFixed(2)
                          : "-"}
                      </td>
                      <td className="p-3 text-slate-400">
                        {typeof valuation?.marketCap === "number"
                          ? valuation.marketCap.toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                            })
                          : "-"}
                      </td>
                      <td className="p-3 text-slate-300">
                        {formatModelName(valuation?.selectedModel || valuation?.model)}
                      </td>
                      <td className="p-3 text-slate-400">
                        {valuation?.confidence || "-"}
                      </td>
                      <td className="p-3 text-slate-400">
                        {formatRatio(valuation?.stablePvRatio)}
                      </td>
                      <td className="p-3 text-slate-400">
                        {formatRatio(valuation?.linearPvRatio)}
                      </td>
                      <td className="p-3 text-slate-400">
                        {formatRatio(valuation?.exponentialPvRatio)}
                      </td>
                      <td className="p-3 text-slate-400">
                        {formatRatio(valuation?.cyclicalPvRatio)}
                      </td>
                      <td className="p-3">{security.companyName}</td>
                      <td className="p-3">{security.tradingName}</td>
                      <td className="p-3 text-slate-400">{security.isin || "-"}</td>
                      <td className="p-3 text-slate-400">{security.mainTicker || "-"}</td>
                      <td className="p-3">
                        {websiteUrl ? (
                          <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300"
                          >
                            {security.website}
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400">{security.hasQuotation || "-"}</td>
                      <td className="p-3 text-slate-400">{security.b3Market || "-"}</td>
                      <td className="p-3">{security.segment || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}













































