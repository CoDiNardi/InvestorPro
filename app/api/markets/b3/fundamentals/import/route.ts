import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type FundamentalRow = {
  market: string;
  codeCVM: string;
  year: number;
  currency: string;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const IMPORT_FILE = path.join(B3_DIR, "import", "fundamentals.csv");
const FUNDAMENTALS_FILE = path.join(B3_DIR, "fundamentals.json");

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

function parseNumber(value: string | undefined) {
  const cleaned = String(value ?? "").trim();

  if (!cleaned) return null;

  const number = Number(cleaned.replace(",", "."));

  if (!Number.isFinite(number)) {
    throw new Error(`Invalid number: ${value}`);
  }

  return number;
}

function requireColumn(headers: string[], name: string) {
  const index = headers.indexOf(name.toLowerCase());

  if (index === -1) {
    throw new Error(`CSV must contain column: ${name}`);
  }

  return index;
}

function parseFundamentalsCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("fundamentals.csv is empty");
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().trim()
  );

  const codeCVMIndex = requireColumn(headers, "codeCVM");
  const yearIndex = requireColumn(headers, "year");
  const currencyIndex = requireColumn(headers, "currency");
  const operatingCashFlowIndex = requireColumn(headers, "operatingCashFlow");
  const capexIndex = requireColumn(headers, "capex");
  const freeCashFlowIndex = requireColumn(headers, "freeCashFlow");
  const totalDebtIndex = requireColumn(headers, "totalDebt");
  const cashAndEquivalentsIndex = requireColumn(headers, "cashAndEquivalents");

  const fundamentals: FundamentalRow[] = [];

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);

    const codeCVM = String(columns[codeCVMIndex] ?? "").trim();
    const year = Number(columns[yearIndex]);
    const currency = String(columns[currencyIndex] ?? "BRL").trim().toUpperCase();

    if (!codeCVM) {
      throw new Error(`Missing codeCVM in line: ${line}`);
    }

    if (!Number.isInteger(year)) {
      throw new Error(`Invalid year in line: ${line}`);
    }

    fundamentals.push({
      market: "b3",
      codeCVM,
      year,
      currency,
      operatingCashFlow: parseNumber(columns[operatingCashFlowIndex]),
      capex: parseNumber(columns[capexIndex]),
      freeCashFlow: parseNumber(columns[freeCashFlowIndex]),
      totalDebt: parseNumber(columns[totalDebtIndex]),
      cashAndEquivalents: parseNumber(columns[cashAndEquivalentsIndex]),
    });
  }

  fundamentals.sort((a, b) => {
    if (a.codeCVM !== b.codeCVM) return a.codeCVM.localeCompare(b.codeCVM);
    return b.year - a.year;
  });

  return fundamentals;
}

export async function POST() {
  try {
    const csv = await fs.readFile(IMPORT_FILE, "utf-8");
    const fundamentals = parseFundamentalsCsv(csv);

    const payload = {
      source: "manual/csv",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: fundamentals.length,
      fundamentals,
    };

    await fs.writeFile(
      FUNDAMENTALS_FILE,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import B3 fundamentals CSV",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
