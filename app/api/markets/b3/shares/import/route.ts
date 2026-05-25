import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type ShareRow = {
  market: string;
  ticker: string;
  sharesOutstanding: number;
  source: string;
  updatedAt: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const IMPORT_FILE = path.join(B3_DIR, "import", "shares.csv");
const SHARES_FILE = path.join(B3_DIR, "shares.json");

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (const char of line) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseSharesCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("shares.csv is empty");
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().trim()
  );

  const tickerIndex = headers.indexOf("ticker");
  const sharesIndex = headers.indexOf("sharesoutstanding");

  if (tickerIndex === -1 || sharesIndex === -1) {
    throw new Error("CSV must contain ticker and sharesOutstanding columns");
  }

  const now = new Date().toISOString();
  const shares: ShareRow[] = [];

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);

    const ticker = String(columns[tickerIndex] ?? "").trim().toUpperCase();
    const sharesText = String(columns[sharesIndex] ?? "").trim();
    const sharesOutstanding = Number(sharesText.replace(",", "."));

    if (!ticker) {
      throw new Error(`Missing ticker in line: ${line}`);
    }

    if (!Number.isFinite(sharesOutstanding) || sharesOutstanding < 0) {
      throw new Error(`Invalid sharesOutstanding for ${ticker}: ${sharesText}`);
    }

    shares.push({
      market: "b3",
      ticker,
      sharesOutstanding,
      source: "manual/csv",
      updatedAt: now,
    });
  }

  shares.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return shares;
}

export async function POST() {
  try {
    const csv = await fs.readFile(IMPORT_FILE, "utf-8");
    const shares = parseSharesCsv(csv);

    const payload = {
      source: "manual/csv",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: shares.length,
      shares,
    };

    await fs.writeFile(SHARES_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import B3 shares CSV",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
