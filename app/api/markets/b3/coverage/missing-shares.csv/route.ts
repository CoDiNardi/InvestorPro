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

type ShareRow = {
  ticker: string;
  sharesOutstanding: number;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const SHARES_FILE = path.join(B3_DIR, "shares.json");

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

  const sharesCache: any = await readJsonOrDefault(SHARES_FILE, {
    shares: [],
  });

  const securities: SecurityRow[] = securitiesCache.securities ?? [];
  const shares: ShareRow[] = sharesCache.shares ?? [];

  const tickersWithShares = new Set(
    shares
      .filter((item) => typeof item.sharesOutstanding === "number")
      .map((item) => item.ticker)
  );

  const missing = securities.filter(
    (security) => !tickersWithShares.has(security.ticker)
  );

  const rows = [
    ["ticker", "sharesOutstanding", "tradingName", "companyName", "codeCVM"],
    ...missing.map((security) => [
      security.ticker,
      "",
      security.tradingName,
      security.companyName,
      security.codeCVM,
    ]),
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="missing-shares.csv"',
    },
  });
}
