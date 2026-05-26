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

type FundamentalRow = {
  codeCVM: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const FUNDAMENTALS_FILE = path.join(B3_DIR, "fundamentals.json");

async function readJsonOrDefault(filePath: string, fallback: unknown) {
  try {
    const file = await fs.readFile(filePath, "utf-8");
    return JSON.parse(file);
  } catch {
    return fallback;
  }
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export async function GET() {
  const securitiesCache: any = await readJsonOrDefault(SECURITIES_FILE, {
    securities: [],
  });

  const fundamentalsCache: any = await readJsonOrDefault(FUNDAMENTALS_FILE, {
    fundamentals: [],
  });

  const securities: SecurityRow[] = securitiesCache.securities ?? [];
  const fundamentals: FundamentalRow[] = fundamentalsCache.fundamentals ?? [];

  const companiesWithFundamentals = new Set(
    fundamentals.map((item) => item.codeCVM)
  );

  const securitiesByCodeCVM = new Map<string, SecurityRow[]>();

  for (const security of securities) {
    if (!securitiesByCodeCVM.has(security.codeCVM)) {
      securitiesByCodeCVM.set(security.codeCVM, []);
    }

    securitiesByCodeCVM.get(security.codeCVM)!.push(security);
  }

  const missingCompanies = Array.from(securitiesByCodeCVM.entries())
    .filter(([codeCVM]) => !companiesWithFundamentals.has(codeCVM))
    .map(([codeCVM, companySecurities]) => ({
      codeCVM,
      tradingName: companySecurities[0]?.tradingName ?? "",
      companyName: companySecurities[0]?.companyName ?? "",
      tickers: companySecurities.map((item) => item.ticker).join(" "),
    }))
    .sort((a, b) => a.tradingName.localeCompare(b.tradingName));

  const currentYear = new Date().getFullYear() - 1;

  const rows = [
    [
      "codeCVM",
      "tradingName",
      "companyName",
      "tickers",
      "year",
      "currency",
      "operatingCashFlow",
      "capex",
      "freeCashFlow",
      "totalDebt",
      "cashAndEquivalents",
    ],
    ...missingCompanies.map((company) => [
      company.codeCVM,
      company.tradingName,
      company.companyName,
      company.tickers,
      currentYear,
      "BRL",
      "",
      "",
      "",
      "",
      "",
    ]),
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="missing-fundamentals.csv"',
    },
  });
}
