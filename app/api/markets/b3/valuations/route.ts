import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const VALUATIONS_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "valuations.json"
);

async function readValuationsCache() {
  try {
    const file = await fs.readFile(VALUATIONS_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "InvestorPro",
      market: "b3",
      updatedAt: null,
      model: "stable_ocf",
      count: 0,
      valuedCount: 0,
      valuations: [],
    };
  }
}

export async function GET() {
  const data = await readValuationsCache();
  return NextResponse.json(data);
}
