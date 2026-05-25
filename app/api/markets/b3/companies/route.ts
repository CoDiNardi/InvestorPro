import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const DATA_FILE = path.join(
  process.cwd(),
  "data",
  "markets",
  "b3",
  "companies.json"
);

async function readCompaniesCache() {
  try {
    const file = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(file);
  } catch {
    return {
      source: "B3",
      market: "b3",
      updatedAt: null,
      count: 0,
      companies: [],
    };
  }
}

export async function GET() {
  const data = await readCompaniesCache();
  return NextResponse.json(data);
}
