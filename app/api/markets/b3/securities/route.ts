import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const SECURITIES_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "securities.json"
);

async function readSecuritiesCache() {
  try {
    const file = await fs.readFile(SECURITIES_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "B3",
      market: "b3",
      updatedAt: null,
      count: 0,
      securities: [],
    };
  }
}

export async function GET() {
  const data = await readSecuritiesCache();
  return NextResponse.json(data);
}
