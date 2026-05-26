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
  cotahistDate?: string | null;
};

type CotahistQuote = {
  ticker: string;
  date: string;
  close: number;
  isin: string;
  bdiCode: string;
  marketType: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const IMPORT_FILE = path.join(B3_DIR, "import", "COTAHIST.txt");
const PRICES_FILE = path.join(B3_DIR, "prices.json");

async function readPricesCache() {
  const file = await fs.readFile(PRICES_FILE, "utf-8");
  return JSON.parse(file);
}

function parseB3Price(value: string) {
  const number = Number(value.trim());

  if (!Number.isFinite(number)) return null;

  return number / 100;
}

function parseCotahistDate(value: string) {
  const raw = value.trim();

  if (!/^\d{8}$/.test(raw)) return null;

  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);

  return `${year}-${month}-${day}`;
}

function parseCotahistLine(line: string): CotahistQuote | null {
  if (line.length < 245) return null;

  const recordType = line.slice(0, 2);

  if (recordType !== "01") return null;

  const rawDate = line.slice(2, 10);
  const date = parseCotahistDate(rawDate);

  if (!date) return null;

  const bdiCode = line.slice(10, 12).trim();
  const ticker = line.slice(12, 24).trim();
  const marketType = line.slice(24, 27).trim();
  const close = parseB3Price(line.slice(108, 121));
  const isin = line.slice(230, 242).trim();

  if (!ticker || typeof close !== "number") return null;

  return {
    ticker,
    date,
    close,
    isin,
    bdiCode,
    marketType,
  };
}

function shouldUseQuote(quote: CotahistQuote) {
  // Mercado à vista usually appears as market type 010.
  // We keep this permissive for now because our prices.json already restricts
  // the import to known investable tickers.
  if (!quote.ticker) return false;
  if (quote.close <= 0) return false;

  return true;
}

export async function POST() {
  try {
    const pricesCache = await readPricesCache();
    const file = await fs.readFile(IMPORT_FILE, "latin1");

    const lines = file.split(/\r?\n/);
    const latestQuoteByTicker = new Map<string, CotahistQuote>();

    for (const line of lines) {
      const quote = parseCotahistLine(line);

      if (!quote || !shouldUseQuote(quote)) continue;

      const existing = latestQuoteByTicker.get(quote.ticker);

      if (!existing || quote.date > existing.date) {
        latestQuoteByTicker.set(quote.ticker, quote);
      }
    }

    const now = new Date().toISOString();

    let updatedCount = 0;
    let unchangedCount = 0;
    const missingTickers: string[] = [];

    const prices: PriceRow[] = (pricesCache.prices ?? []).map((row: PriceRow) => {
      const quote = latestQuoteByTicker.get(row.ticker);

      if (!quote) {
        missingTickers.push(row.ticker);
        return row;
      }

      const samePrice = row.price === quote.close;

      if (samePrice) {
        unchangedCount++;
      } else {
        updatedCount++;
      }

      return {
        ...row,
        price: quote.close,
        priceUpdatedAt: now,
        source: "b3_cotahist",
        cotahistDate: quote.date,
        isin: row.isin || quote.isin,
      };
    });

    const payload = {
      source: "b3_cotahist",
      market: "b3",
      updatedAt: now,
      count: prices.length,
      updatedCount,
      unchangedCount,
      matchedTickers: prices.length - missingTickers.length,
      missingTickers,
      cotahistQuotesFound: latestQuoteByTicker.size,
      prices,
    };

    await fs.writeFile(PRICES_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import B3 COTAHIST prices",
        details: error instanceof Error ? error.message : String(error),
        expectedFile: "data/markets/b3/import/COTAHIST.txt",
      },
      { status: 500 }
    );
  }
}
