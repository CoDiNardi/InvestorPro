import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type Security = {
  ticker: string;
  isin: string;
  shareClass: string;
  companyName: string;
  tradingName: string;
  codeCVM: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const PRICES_FILE = path.join(B3_DIR, "prices.json");

async function readSecuritiesCache() {
  const file = await fs.readFile(SECURITIES_FILE, "utf-8");
  return JSON.parse(file);
}

async function readExistingPrices() {
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

export async function POST() {
  try {
    const securitiesCache = await readSecuritiesCache();
    const existingPricesCache = await readExistingPrices();

    const securities: Security[] = securitiesCache.securities ?? [];
    const existingPrices = existingPricesCache.prices ?? [];

    const existingPriceByTicker = new Map(
      existingPrices.map((item: any) => [item.ticker, item])
    );

    const prices = securities.map((security) => {
      const existing = existingPriceByTicker.get(security.ticker) as any;

      return {
        market: "b3",
        ticker: security.ticker,
        isin: security.isin,
        shareClass: security.shareClass,
        codeCVM: security.codeCVM,
        companyName: security.companyName,
        tradingName: security.tradingName,
        currency: "BRL",
        price: existing?.price ?? null,
        priceUpdatedAt: existing?.priceUpdatedAt ?? null,
        source: existing?.source ?? "manual",
      };
    });

    const payload = {
      source: "manual",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: prices.length,
      prices,
    };

    await fs.mkdir(B3_DIR, { recursive: true });
    await fs.writeFile(PRICES_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not initialize B3 prices file",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
