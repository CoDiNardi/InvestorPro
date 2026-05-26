import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type SecurityRow = {
  market: string;
  codeCVM: string;
  companyName: string;
  tradingName: string;
  ticker: string;
  isin: string;
  shareClass: string;
};

type CompanyDetailRow = {
  codeCVM: string;
  companyName: string;
  tradingName: string;
  detail?: {
    issuingCompany?: string;
  };
};

type ShareRow = {
  market: string;
  ticker: string;
  sharesOutstanding: number;
  source: string;
  updatedAt: string;
  note?: string;
};

type CapitalData = {
  totalShares: number | null;
  commonShares: number | null;
  preferredShares: number | null;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const DETAILS_FILE = path.join(B3_DIR, "company-details.json");
const SHARES_FILE = path.join(B3_DIR, "shares.json");

async function readJsonOrDefault(filePath: string, fallback: unknown) {
  try {
    const file = await fs.readFile(filePath, "utf-8");
    return JSON.parse(file);
  } catch {
    return fallback;
  }
}

function normalizeNumber(text: string) {
  const cleaned = text.replace(/[^\d]/g, "");
  if (!cleaned) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractNumberAfterLabel(html: string, labels: string[]) {
  const normalized = decodeHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<[^>]*>/g, " ");

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\s*([0-9][0-9.,]*)`, "i");
    const match = normalized.match(pattern);

    if (match?.[1]) {
      return normalizeNumber(match[1]);
    }
  }

  return null;
}

function parseCapitalData(html: string): CapitalData {
  return {
    totalShares: extractNumberAfterLabel(html, [
      "Total Number of Shares",
      "Quantidade Total de Ações",
      "Quantidade Total de Acoes",
    ]),
    commonShares: extractNumberAfterLabel(html, [
      "Number of Common Shares",
      "Quantidade de Ações Ordinárias",
      "Quantidade de Acoes Ordinarias",
    ]),
    preferredShares: extractNumberAfterLabel(html, [
      "Number of Preferred Shares",
      "Quantidade de Ações Preferenciais",
      "Quantidade de Acoes Preferenciais",
    ]),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function groupByCodeCVM(securities: SecurityRow[]) {
  const map = new Map<string, SecurityRow[]>();

  for (const security of securities) {
    if (!map.has(security.codeCVM)) map.set(security.codeCVM, []);
    map.get(security.codeCVM)!.push(security);
  }

  return map;
}

function buildShareRowsForCompany(args: {
  securities: SecurityRow[];
  capital: CapitalData;
  now: string;
}) {
  const { securities, capital, now } = args;

  const rows: ShareRow[] = [];
  const warnings: string[] = [];

  const onTickers = securities.filter((item) => item.shareClass === "ON");
  const pnTickers = securities.filter((item) => item.shareClass === "PN");
  const preferredClassTickers = securities.filter((item) =>
    ["PNA", "PNB", "PNC", "PND"].includes(item.shareClass)
  );
  const unitTickers = securities.filter((item) => item.shareClass === "UNIT");

  if (onTickers.length === 1 && typeof capital.commonShares === "number") {
    rows.push({
      market: "b3",
      ticker: onTickers[0].ticker,
      sharesOutstanding: capital.commonShares,
      source: "b3_capital_page",
      updatedAt: now,
      note: "Mapped from Number of Common Shares.",
    });
  }

  if (pnTickers.length === 1 && typeof capital.preferredShares === "number") {
    rows.push({
      market: "b3",
      ticker: pnTickers[0].ticker,
      sharesOutstanding: capital.preferredShares,
      source: "b3_capital_page",
      updatedAt: now,
      note: "Mapped from Number of Preferred Shares.",
    });
  }

  if (
    onTickers.length === 1 &&
    pnTickers.length === 0 &&
    preferredClassTickers.length === 0 &&
    unitTickers.length === 0 &&
    typeof capital.totalShares === "number" &&
    rows.length === 0
  ) {
    rows.push({
      market: "b3",
      ticker: onTickers[0].ticker,
      sharesOutstanding: capital.totalShares,
      source: "b3_capital_page",
      updatedAt: now,
      note: "ON-only company. Mapped from Total Number of Shares.",
    });
  }

  for (const ticker of preferredClassTickers) {
    warnings.push(
      `${ticker.ticker}: preferred subclass ${ticker.shareClass} requires manual allocation.`
    );
  }

  for (const ticker of unitTickers) {
    warnings.push(`${ticker.ticker}: UNIT ticker requires manual review.`);
  }

  if (rows.length === 0) {
    warnings.push("No share count could be safely mapped for this company.");
  }

  return { rows, warnings };
}

export async function POST() {
  try {
    const securitiesCache: any = await readJsonOrDefault(SECURITIES_FILE, {
      securities: [],
    });
    const detailsCache: any = await readJsonOrDefault(DETAILS_FILE, {
      details: [],
    });
    const existingSharesCache: any = await readJsonOrDefault(SHARES_FILE, {
      shares: [],
    });

    const securities: SecurityRow[] = securitiesCache.securities ?? [];
    const details: CompanyDetailRow[] = detailsCache.details ?? [];
    const existingShares: ShareRow[] = existingSharesCache.shares ?? [];

    const detailsByCodeCVM = new Map(details.map((item) => [item.codeCVM, item]));
    const securitiesByCodeCVM = groupByCodeCVM(securities);

    const existingByTicker = new Map(
      existingShares.map((item) => [item.ticker, item])
    );

    const now = new Date().toISOString();

    const importedRows: ShareRow[] = [];
    const companyReports = [];

    for (const [codeCVM, companySecurities] of securitiesByCodeCVM.entries()) {
      const detail = detailsByCodeCVM.get(codeCVM);
      const issuingCompany =
        detail?.detail?.issuingCompany || companySecurities[0]?.ticker?.slice(0, 4);

      if (!issuingCompany) {
        companyReports.push({
          codeCVM,
          status: "skipped",
          reason: "Missing issuingCompany",
        });
        continue;
      }

      const url = `https://sistemaswebb3-listados.b3.com.br/listedCompaniesPage/main/${codeCVM}/${issuingCompany}/corporate-actions?language=en-US`;

      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "InvestorPro/1.0",
            Accept: "text/html",
          },
        });

        if (!response.ok) {
          companyReports.push({
            codeCVM,
            issuingCompany,
            status: "error",
            reason: `HTTP ${response.status}`,
          });
          continue;
        }

        const html = await response.text();
        const capital = parseCapitalData(html);

        const { rows, warnings } = buildShareRowsForCompany({
          securities: companySecurities,
          capital,
          now,
        });

        for (const row of rows) {
          existingByTicker.set(row.ticker, row);
          importedRows.push(row);
        }

        companyReports.push({
          codeCVM,
          tradingName: companySecurities[0]?.tradingName ?? "",
          issuingCompany,
          status: rows.length > 0 ? "imported" : "review",
          capital,
          importedTickers: rows.map((item) => item.ticker),
          warnings,
        });

        await sleep(80);
      } catch (error) {
        companyReports.push({
          codeCVM,
          issuingCompany,
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const shares = Array.from(existingByTicker.values()).sort((a, b) =>
      a.ticker.localeCompare(b.ticker)
    );

    const payload = {
      source: "b3_capital_page",
      market: "b3",
      updatedAt: now,
      count: shares.length,
      importedCount: importedRows.length,
      reviewedCompanies: companyReports.length,
      importedCompanies: companyReports.filter((item) => item.status === "imported")
        .length,
      reviewCompanies: companyReports.filter((item) => item.status === "review")
        .length,
      errorCompanies: companyReports.filter((item) => item.status === "error")
        .length,
      shares,
      report: companyReports,
    };

    await fs.writeFile(SHARES_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import shares from B3 capital pages",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
