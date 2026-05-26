import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type IrCheckRow = {
  market: string;
  codeCVM: string;
  year: number;
  metric: string;
  cvmValue: number | null;
  irValue: number | null;
  difference: number | null;
  differencePct: number | null;
  status: string;
  sourceUrl: string;
  notes: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const IMPORT_FILE = path.join(B3_DIR, "import", "ir-checks.csv");
const IR_CHECKS_FILE = path.join(B3_DIR, "ir-checks.json");

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

function normalizeStatus(value: string) {
  const status = value.trim().toLowerCase();

  const allowed = new Set([
    "not_checked",
    "ok",
    "minor_difference",
    "review",
    "conflict",
  ]);

  if (!allowed.has(status)) {
    throw new Error(
      `Invalid IR check status: ${value}. Use not_checked, ok, minor_difference, review, or conflict.`
    );
  }

  return status;
}

function parseIrChecksCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("ir-checks.csv is empty");
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().trim()
  );

  const codeCVMIndex = requireColumn(headers, "codeCVM");
  const yearIndex = requireColumn(headers, "year");
  const metricIndex = requireColumn(headers, "metric");
  const cvmValueIndex = requireColumn(headers, "cvmValue");
  const irValueIndex = requireColumn(headers, "irValue");
  const statusIndex = requireColumn(headers, "status");
  const sourceUrlIndex = requireColumn(headers, "sourceUrl");
  const notesIndex = requireColumn(headers, "notes");

  const checks: IrCheckRow[] = [];

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);

    const codeCVM = String(columns[codeCVMIndex] ?? "").trim();
    const year = Number(columns[yearIndex]);
    const metric = String(columns[metricIndex] ?? "").trim();
    const cvmValue = parseNumber(columns[cvmValueIndex]);
    const irValue = parseNumber(columns[irValueIndex]);
    const status = normalizeStatus(String(columns[statusIndex] ?? ""));
    const sourceUrl = String(columns[sourceUrlIndex] ?? "").trim();
    const notes = String(columns[notesIndex] ?? "").trim();

    if (!codeCVM) throw new Error(`Missing codeCVM in line: ${line}`);
    if (!Number.isInteger(year)) throw new Error(`Invalid year in line: ${line}`);
    if (!metric) throw new Error(`Missing metric in line: ${line}`);

    const difference =
      typeof cvmValue === "number" && typeof irValue === "number"
        ? irValue - cvmValue
        : null;

    const differencePct =
      typeof difference === "number" &&
      typeof cvmValue === "number" &&
      cvmValue !== 0
        ? difference / cvmValue
        : null;

    checks.push({
      market: "b3",
      codeCVM,
      year,
      metric,
      cvmValue,
      irValue,
      difference,
      differencePct,
      status,
      sourceUrl,
      notes,
    });
  }

  checks.sort((a, b) => {
    if (a.codeCVM !== b.codeCVM) return a.codeCVM.localeCompare(b.codeCVM);
    if (a.year !== b.year) return b.year - a.year;
    return a.metric.localeCompare(b.metric);
  });

  return checks;
}

export async function POST() {
  try {
    const csv = await fs.readFile(IMPORT_FILE, "utf-8");
    const checks = parseIrChecksCsv(csv);

    const payload = {
      source: "manual/csv",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: checks.length,
      checks,
    };

    await fs.writeFile(IR_CHECKS_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import B3 IR checks CSV",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
