import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const SHARES_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "shares.json"
);

async function readSharesCache() {
  try {
    const file = await fs.readFile(SHARES_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "manual/csv",
      market: "b3",
      updatedAt: null,
      count: 0,
      shares: [],
    };
  }
}

export async function GET() {
  const data = await readSharesCache();
  return NextResponse.json(data);
}
