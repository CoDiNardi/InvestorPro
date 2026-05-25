import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

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

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const PRICES_FILE = path.join(B3_DIR, "prices.json");
const IMPORT_FILE = path.join(B3_DIR, "import", "prices.csv");

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPricesCache() {
  try {
    const file = await fs.readFile(PRICES_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "manual",
      market: "b3",
      updatedAt: null,
      count: 0,
      prices: [],
    };
  }
}

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

function parsePriceCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return new Map<string, number>();
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().trim()
  );

  const tickerIndex = headers.indexOf("ticker");
  const priceIndex = headers.indexOf("price");

  if (tickerIndex === -1 || priceIndex === -1) {
    throw new Error("CSV must contain ticker and price columns");
  }

  const updates = new Map<string, number>();

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const ticker = String(columns[tickerIndex] ?? "").trim().toUpperCase();
    const priceText = String(columns[priceIndex] ?? "")
      .trim()
      .replace(",", ".");

    if (!ticker) continue;

    const price = Number(priceText);

    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Invalid price for ${ticker}: ${priceText}`);
    }

    updates.set(ticker, price);
  }

  return updates;
}

async function autoImportCsvIfNeeded(pricesCache: any) {
  const csvExists = await fileExists(IMPORT_FILE);

  if (!csvExists) {
    return pricesCache;
  }

  const pricesExists = await fileExists(PRICES_FILE);

  if (pricesExists) {
    const csvStat = await fs.stat(IMPORT_FILE);
    const pricesStat = await fs.stat(PRICES_FILE);

    if (csvStat.mtimeMs <= pricesStat.mtimeMs) {
      return pricesCache;
    }
  }

  const csv = await fs.readFile(IMPORT_FILE, "utf-8");
  const updates = parsePriceCsv(csv);
  const now = new Date().toISOString();

  let updatedCount = 0;
  const missingTickers: string[] = [];

  const prices: PriceRow[] = (pricesCache.prices ?? []).map(
    (row: PriceRow) => {
      if (!updates.has(row.ticker)) return row;

      updatedCount++;

      return {
        ...row,
        price: updates.get(row.ticker) ?? null,
        priceUpdatedAt: now,
        source: "csv",
      };
    }
  );

  const knownTickers = new Set(prices.map((row) => row.ticker));

  for (const ticker of updates.keys()) {
    if (!knownTickers.has(ticker)) {
      missingTickers.push(ticker);
    }
  }

  const payload = {
    source: "manual/csv",
    market: "b3",
    updatedAt: now,
    count: prices.length,
    updatedCount,
    missingTickers,
    prices,
  };

  await fs.writeFile(PRICES_FILE, JSON.stringify(payload, null, 2), "utf-8");

  return payload;
}

export async function GET() {
  try {
    const pricesCache = await readPricesCache();
    const data = await autoImportCsvIfNeeded(pricesCache);

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not load B3 prices",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
