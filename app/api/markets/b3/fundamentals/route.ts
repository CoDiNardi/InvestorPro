import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const FUNDAMENTALS_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "fundamentals.json"
);

async function readFundamentalsCache() {
  try {
    const file = await fs.readFile(FUNDAMENTALS_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "manual/csv",
      market: "b3",
      updatedAt: null,
      count: 0,
      fundamentals: [],
    };
  }
}

export async function GET() {
  const data = await readFundamentalsCache();
  return NextResponse.json(data);
}
