import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const DETAILS_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "company-details.json"
);

async function readCompanyDetailsCache() {
  try {
    const file = await fs.readFile(DETAILS_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "B3",
      market: "b3",
      updatedAt: null,
      count: 0,
      successCount: 0,
      errorCount: 0,
      details: [],
    };
  }
}

export async function GET() {
  const data = await readCompanyDetailsCache();
  return NextResponse.json(data);
}
