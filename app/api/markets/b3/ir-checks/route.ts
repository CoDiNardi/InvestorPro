import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const IR_CHECKS_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "ir-checks.json"
);

async function readIrChecksCache() {
  try {
    const file = await fs.readFile(IR_CHECKS_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "manual/csv",
      market: "b3",
      updatedAt: null,
      count: 0,
      checks: [],
    };
  }
}

export async function GET() {
  const data = await readIrChecksCache();
  return NextResponse.json(data);
}
