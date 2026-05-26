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
  source: string;
  updatedAt: string;
  notes?: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const DFP_EXTRACTED_DIR = path.join(B3_DIR, "cvm", "dfp", "extracted");
const FUNDAMENTALS_FILE = path.join(B3_DIR, "fundamentals.json");

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (const char of line) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ";" && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

async function readSemicolonCsv(filePath: string) {
  const file = await fs.readFile(filePath, "latin1");

  return file
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function normalizeCvmCode(value: string | undefined) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";

  return String(Number(digits));
}

function parseNumber(value: string | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  if (!cleaned) return null;

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

function scaleValue(value: number | null, scale: string | undefined) {
  if (value === null) return null;

  const normalizedScale = String(scale ?? "").toUpperCase();

  if (normalizedScale === "MIL") return value * 1000;
  if (normalizedScale === "UNIDADE") return value;

  return value;
}

function findHeaderIndex(header: string[], name: string) {
  const index = header.indexOf(name);
  if (index === -1) throw new Error(`Missing CSV column: ${name}`);
  return index;
}

function isLatestExercise(value: string | undefined) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  return normalized === "ULTIMO";
}

async function getAvailableDfpYears() {
  const entries = await fs.readdir(DFP_EXTRACTED_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => b - a);
}

async function readStatementRows(year: number, statementName: string) {
  const filePath = path.join(
    DFP_EXTRACTED_DIR,
    String(year),
    `dfp_cia_aberta_${statementName}_${year}.csv`
  );

  if (!(await fileExists(filePath))) return [];

  return readSemicolonCsv(filePath);
}

function getYearFromDate(dateText: string | undefined, fallbackYear: number) {
  const match = String(dateText ?? "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : fallbackYear;
}

type ParsedStatementRow = {
  codeCVM: string;
  companyName: string;
  exerciseYear: number;
  accountCode: string;
  accountName: string;
  value: number | null;
};

async function parseRowsForAccounts(args: {
  year: number;
  statementName: string;
  accountCodes: Set<string>;
}) {
  const { year, statementName, accountCodes } = args;

  const rows = await readStatementRows(year, statementName);
  if (rows.length === 0) return [];

  const header = rows[0];

  const companyNameIndex = findHeaderIndex(header, "DENOM_CIA");
  const codeCvmIndex = findHeaderIndex(header, "CD_CVM");
  const scaleIndex = findHeaderIndex(header, "ESCALA_MOEDA");
  const orderIndex = findHeaderIndex(header, "ORDEM_EXERC");
  const dateIndex =
    header.indexOf("DT_FIM_EXERC") !== -1
      ? header.indexOf("DT_FIM_EXERC")
      : findHeaderIndex(header, "DT_REFER");
  const accountCodeIndex = findHeaderIndex(header, "CD_CONTA");
  const accountNameIndex = findHeaderIndex(header, "DS_CONTA");
  const valueIndex = findHeaderIndex(header, "VL_CONTA");

  const parsed: ParsedStatementRow[] = [];

  for (const columns of rows.slice(1)) {
    if (!isLatestExercise(columns[orderIndex])) continue;

    const accountCode = columns[accountCodeIndex];

    if (!accountCodes.has(accountCode)) continue;

    const rawValue = parseNumber(columns[valueIndex]);
    const value = scaleValue(rawValue, columns[scaleIndex]);

    parsed.push({
      codeCVM: normalizeCvmCode(columns[codeCvmIndex]),
      companyName: columns[companyNameIndex] ?? "",
      exerciseYear: getYearFromDate(columns[dateIndex], year),
      accountCode,
      accountName: columns[accountNameIndex] ?? "",
      value,
    });
  }

  return parsed;
}

export async function POST() {
  try {
    const years = await getAvailableDfpYears();

    const now = new Date().toISOString();

    const ocfByCompanyYear = new Map<string, ParsedStatementRow>();
    const cashByCompanyYear = new Map<string, ParsedStatementRow>();
    const debtByCompanyYear = new Map<string, number>();

    for (const year of years) {
      const ocfRows = await parseRowsForAccounts({
        year,
        statementName: "DFC_MI_con",
        accountCodes: new Set(["6.01"]),
      });

      for (const row of ocfRows) {
        const key = `${row.codeCVM}:${row.exerciseYear}`;
        ocfByCompanyYear.set(key, row);
      }

      const cashRows = await parseRowsForAccounts({
        year,
        statementName: "BPA_con",
        accountCodes: new Set(["1.01", "1.01.01"]),
      });

      for (const row of cashRows) {
        const key = `${row.codeCVM}:${row.exerciseYear}`;

        const existing = cashByCompanyYear.get(key);

        // Prefer fixed account 1.01.01 where available; otherwise use 1.01.
        if (!existing || row.accountCode === "1.01.01") {
          cashByCompanyYear.set(key, row);
        }
      }

      const debtRows = await parseRowsForAccounts({
        year,
        statementName: "BPP_con",
        accountCodes: new Set(["2.01.04", "2.02.01"]),
      });

      for (const row of debtRows) {
        const key = `${row.codeCVM}:${row.exerciseYear}`;
        debtByCompanyYear.set(
          key,
          (debtByCompanyYear.get(key) ?? 0) + (row.value ?? 0)
        );
      }
    }

    const fundamentals: FundamentalRow[] = [];

    for (const [key, ocfRow] of ocfByCompanyYear) {
      const [codeCVM, yearText] = key.split(":");
      const year = Number(yearText);

      fundamentals.push({
        market: "b3",
        codeCVM,
        year,
        currency: "BRL",
        operatingCashFlow: ocfRow.value,
        capex: null,
        freeCashFlow: null,
        totalDebt: debtByCompanyYear.get(key) ?? null,
        cashAndEquivalents: cashByCompanyYear.get(key)?.value ?? null,
        source: "cvm_dfp",
        updatedAt: now,
        notes:
          "DFP consolidated. OCF from DFC_MI_con 6.01. Cash from BPA_con 1.01/1.01.01. Debt from BPP_con 2.01.04 + 2.02.01.",
      });
    }

    fundamentals.sort((a, b) => {
      if (a.codeCVM !== b.codeCVM) return a.codeCVM.localeCompare(b.codeCVM);
      return b.year - a.year;
    });

    const payload = {
      source: "cvm_dfp",
      market: "b3",
      updatedAt: now,
      dfpYearsAvailable: years,
      count: fundamentals.length,
      companiesCount: new Set(fundamentals.map((item) => item.codeCVM)).size,
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
        error: "Could not import fundamentals from CVM DFP data",
        details: error instanceof Error ? error.message : String(error),
        expectedFolder: "data/markets/b3/cvm/dfp/extracted",
      },
      { status: 500 }
    );
  }
}
