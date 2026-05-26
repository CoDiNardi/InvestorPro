import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type SecurityRow = {
  market: string;
  codeCVM: string;
  companyName: string;
  tradingName: string;
  ticker: string;
  isin: string;
  shareClass: string;
};

type ExistingShareRow = {
  market: string;
  ticker: string;
  sharesOutstanding: number;
  source: string;
  updatedAt: string;
  note?: string;
};

type ShareRow = ExistingShareRow & {
  codeCVM?: string;
  tradingName?: string;
  companyName?: string;
  shareClass?: string;
};

type FreCompanyRow = {
  cnpj: string;
  codeCVM: string;
  companyName: string;
  documentId: string;
};

type FreCapitalRow = {
  cnpj: string;
  documentId: string;
  companyName: string;
  capitalType: string;
  ordinaryShares: number;
  preferredShares: number;
  totalShares: number;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const FRE_DIR = path.join(B3_DIR, "cvm", "fre", "extracted", "2026");

const SECURITIES_FILE = path.join(B3_DIR, "securities.json");
const SHARES_FILE = path.join(B3_DIR, "shares.json");

const FRE_MAIN_FILE = path.join(FRE_DIR, "fre_cia_aberta_2026.csv");
const FRE_CAPITAL_FILE = path.join(
  FRE_DIR,
  "fre_cia_aberta_capital_social_2026.csv"
);

async function readJsonOrDefault(filePath: string, fallback: unknown) {
  try {
    const file = await fs.readFile(filePath, "utf-8");
    return JSON.parse(file);
  } catch {
    return fallback;
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

function parseNumber(value: string | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  if (!cleaned) return 0;

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function normalizeCvmCode(value: string | undefined) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";

  return String(Number(digits));
}

async function readSemicolonCsv(filePath: string) {
  const file = await fs.readFile(filePath, "latin1");

  return file
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function groupSecuritiesByCodeCVM(securities: SecurityRow[]) {
  const map = new Map<string, SecurityRow[]>();

  for (const security of securities) {
    if (!map.has(security.codeCVM)) {
      map.set(security.codeCVM, []);
    }

    map.get(security.codeCVM)!.push(security);
  }

  return map;
}

function findHeaderIndex(header: string[], names: string[]) {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index !== -1) return index;
  }

  return -1;
}

async function readFreCompanies() {
  const rows = await readSemicolonCsv(FRE_MAIN_FILE);
  const header = rows[0];

  const cnpjIndex = findHeaderIndex(header, ["CNPJ_CIA", "CNPJ_Companhia"]);
  const companyNameIndex = findHeaderIndex(header, ["DENOM_CIA", "Nome_Companhia"]);
  const codeCvmIndex = findHeaderIndex(header, ["CD_CVM", "Codigo_CVM"]);
  const documentIdIndex = findHeaderIndex(header, ["ID_DOC", "ID_Documento"]);

  if (
    cnpjIndex === -1 ||
    companyNameIndex === -1 ||
    codeCvmIndex === -1 ||
    documentIdIndex === -1
  ) {
    throw new Error(
      `Unexpected FRE main CSV header: ${header.join(";")}`
    );
  }

  const companies: FreCompanyRow[] = [];

  for (const columns of rows.slice(1)) {
    const cnpj = columns[cnpjIndex];
    const codeCVM = normalizeCvmCode(columns[codeCvmIndex]);

    if (!cnpj || !codeCVM) continue;

    companies.push({
      cnpj,
      codeCVM,
      companyName: columns[companyNameIndex] ?? "",
      documentId: columns[documentIdIndex] ?? "",
    });
  }

  return companies;
}

async function readFreCapitalRows() {
  const rows = await readSemicolonCsv(FRE_CAPITAL_FILE);
  const header = rows[0];

  const cnpjIndex = header.indexOf("CNPJ_Companhia");
  const documentIdIndex = header.indexOf("ID_Documento");
  const companyNameIndex = header.indexOf("Nome_Companhia");
  const capitalTypeIndex = header.indexOf("Tipo_Capital");
  const ordinaryIndex = header.indexOf("Quantidade_Acoes_Ordinarias");
  const preferredIndex = header.indexOf("Quantidade_Acoes_Preferenciais");
  const totalIndex = header.indexOf("Quantidade_Total_Acoes");

  if (
    cnpjIndex === -1 ||
    documentIdIndex === -1 ||
    companyNameIndex === -1 ||
    capitalTypeIndex === -1 ||
    ordinaryIndex === -1 ||
    preferredIndex === -1 ||
    totalIndex === -1
  ) {
    throw new Error("Unexpected FRE capital social CSV header");
  }

  const capitalRows: FreCapitalRow[] = [];

  for (const columns of rows.slice(1)) {
    const capitalType = columns[capitalTypeIndex] ?? "";

    if (capitalType !== "Capital Emitido") continue;

    capitalRows.push({
      cnpj: columns[cnpjIndex] ?? "",
      documentId: columns[documentIdIndex] ?? "",
      companyName: columns[companyNameIndex] ?? "",
      capitalType,
      ordinaryShares: parseNumber(columns[ordinaryIndex]),
      preferredShares: parseNumber(columns[preferredIndex]),
      totalShares: parseNumber(columns[totalIndex]),
    });
  }

  return capitalRows;
}

function buildRowsForCompany(args: {
  codeCVM: string;
  securities: SecurityRow[];
  capital: FreCapitalRow;
  now: string;
}) {
  const { codeCVM, securities, capital, now } = args;

  const rows: ShareRow[] = [];
  const warnings: string[] = [];

  const onTickers = securities.filter((item) => item.shareClass === "ON");
  const pnTickers = securities.filter((item) => item.shareClass === "PN");
  const unitTickers = securities.filter((item) => item.shareClass === "UNIT");
  const preferredSubclassTickers = securities.filter((item) =>
    ["PNA", "PNB", "PNC", "PND"].includes(item.shareClass)
  );

  if (onTickers.length === 1 && capital.ordinaryShares > 0) {
    const security = onTickers[0];

    rows.push({
      market: "b3",
      ticker: security.ticker,
      codeCVM,
      tradingName: security.tradingName,
      companyName: security.companyName,
      shareClass: security.shareClass,
      sharesOutstanding: capital.ordinaryShares,
      source: "cvm_fre_capital_social",
      updatedAt: now,
      note: "Mapped from FRE Capital Emitido / Quantidade_Acoes_Ordinarias.",
    });
  }

  if (pnTickers.length === 1 && capital.preferredShares > 0) {
    const security = pnTickers[0];

    rows.push({
      market: "b3",
      ticker: security.ticker,
      codeCVM,
      tradingName: security.tradingName,
      companyName: security.companyName,
      shareClass: security.shareClass,
      sharesOutstanding: capital.preferredShares,
      source: "cvm_fre_capital_social",
      updatedAt: now,
      note: "Mapped from FRE Capital Emitido / Quantidade_Acoes_Preferenciais.",
    });
  }

  if (
    onTickers.length === 1 &&
    pnTickers.length === 0 &&
    preferredSubclassTickers.length === 0 &&
    unitTickers.length === 0 &&
    rows.length === 0 &&
    capital.totalShares > 0
  ) {
    const security = onTickers[0];

    rows.push({
      market: "b3",
      ticker: security.ticker,
      codeCVM,
      tradingName: security.tradingName,
      companyName: security.companyName,
      shareClass: security.shareClass,
      sharesOutstanding: capital.totalShares,
      source: "cvm_fre_capital_social",
      updatedAt: now,
      note: "ON-only fallback mapped from FRE Quantidade_Total_Acoes.",
    });
  }

  if (onTickers.length > 1) {
    warnings.push("Multiple ON tickers; manual review required.");
  }

  if (pnTickers.length > 1) {
    warnings.push("Multiple PN tickers; manual review required.");
  }

  for (const ticker of preferredSubclassTickers) {
    warnings.push(
      `${ticker.ticker}: preferred subclass ${ticker.shareClass} requires class-level mapping.`
    );
  }

  for (const ticker of unitTickers) {
    warnings.push(`${ticker.ticker}: UNIT ticker requires manual review.`);
  }

  if (rows.length === 0) {
    warnings.push("No share row could be safely mapped.");
  }

  return { rows, warnings };
}

export async function POST() {
  try {
    const securitiesCache: any = await readJsonOrDefault(SECURITIES_FILE, {
      securities: [],
    });

    const existingSharesCache: any = await readJsonOrDefault(SHARES_FILE, {
      shares: [],
    });

    const securities: SecurityRow[] = securitiesCache.securities ?? [];
    const existingShares: ExistingShareRow[] = existingSharesCache.shares ?? [];

    const freCompanies = await readFreCompanies();
    const freCapitalRows = await readFreCapitalRows();

    const freCompanyByCnpj = new Map(
      freCompanies.map((company) => [company.cnpj, company])
    );

    const capitalByCodeCVM = new Map<string, FreCapitalRow>();

    for (const capital of freCapitalRows) {
      const company = freCompanyByCnpj.get(capital.cnpj);
      if (!company?.codeCVM) continue;

      capitalByCodeCVM.set(company.codeCVM, capital);
    }

    const securitiesByCodeCVM = groupSecuritiesByCodeCVM(securities);

    const existingByTicker = new Map(
      existingShares.map((item) => [item.ticker, item])
    );

    const now = new Date().toISOString();
    const importedRows: ShareRow[] = [];
    const reports = [];

    for (const [codeCVM, companySecurities] of securitiesByCodeCVM) {
      const capital = capitalByCodeCVM.get(codeCVM);

      if (!capital) {
        reports.push({
          codeCVM,
          tradingName: companySecurities[0]?.tradingName ?? "",
          status: "missing_fre_capital",
          tickers: companySecurities.map((item) => item.ticker),
        });
        continue;
      }

      const { rows, warnings } = buildRowsForCompany({
        codeCVM,
        securities: companySecurities,
        capital,
        now,
      });

      for (const row of rows) {
        existingByTicker.set(row.ticker, row);
        importedRows.push(row);
      }

      reports.push({
        codeCVM,
        tradingName: companySecurities[0]?.tradingName ?? "",
        status: rows.length > 0 ? "imported" : "review",
        capital: {
          ordinaryShares: capital.ordinaryShares,
          preferredShares: capital.preferredShares,
          totalShares: capital.totalShares,
        },
        importedTickers: rows.map((row) => row.ticker),
        warnings,
      });
    }

    const shares = Array.from(existingByTicker.values()).sort((a, b) =>
      a.ticker.localeCompare(b.ticker)
    );

    const payload = {
      source: "cvm_fre_capital_social",
      market: "b3",
      updatedAt: now,
      freYear: 2026,
      count: shares.length,
      importedCount: importedRows.length,
      reviewedCompanies: reports.length,
      importedCompanies: reports.filter((item) => item.status === "imported")
        .length,
      reviewCompanies: reports.filter((item) => item.status === "review").length,
      missingFreCapitalCompanies: reports.filter(
        (item) => item.status === "missing_fre_capital"
      ).length,
      shares,
      report: reports,
    };

    await fs.writeFile(SHARES_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not import shares from CVM FRE capital social data",
        details: error instanceof Error ? error.message : String(error),
        expectedFiles: [
          "data/markets/b3/cvm/fre/extracted/2026/fre_cia_aberta_2026.csv",
          "data/markets/b3/cvm/fre/extracted/2026/fre_cia_aberta_capital_social_2026.csv",
        ],
      },
      { status: 500 }
    );
  }
}

