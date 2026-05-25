import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type SecurityCode = {
  code: string;
  isin?: string;
};

type DetailData = {
  code?: string;
  otherCodes?: SecurityCode[];
  website?: string;
  hasQuotation?: string;
  market?: string;
  activity?: string;
  industryClassification?: string;
};

type CompanyDetailRecord = {
  codeCVM: string;
  companyName: string;
  tradingName: string;
  cnpj: string;
  marketIndicator: string;
  segment: string;
  detail?: DetailData;
  error?: string;
};

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const DETAILS_FILE = path.join(B3_DIR, "company-details.json");
const SECURITIES_FILE = path.join(B3_DIR, "securities.json");

function isLikelyEquityTicker(code: string) {
  return /^[A-Z0-9]{4}(3|4|5|6|11)$/.test(code);
}

function getShareClass(code: string) {
  if (code.endsWith("11")) return "UNIT";
  if (code.endsWith("3")) return "ON";
  if (code.endsWith("4")) return "PN";
  if (code.endsWith("5")) return "PNA";
  if (code.endsWith("6")) return "PNB";
  return "UNKNOWN";
}

async function readCompanyDetailsCache() {
  const file = await fs.readFile(DETAILS_FILE, "utf-8");
  return JSON.parse(file);
}

export async function POST() {
  try {
    const detailsCache = await readCompanyDetailsCache();
    const detailRecords: CompanyDetailRecord[] = detailsCache.details ?? [];

    const securities = [];

    for (const record of detailRecords) {
      if (!record.detail || record.error) continue;

      const codes = record.detail.otherCodes ?? [];

      for (const item of codes) {
        const ticker = item.code;

        if (!isLikelyEquityTicker(ticker)) continue;

        securities.push({
          market: "b3",
          codeCVM: record.codeCVM,
          companyName: record.companyName,
          tradingName: record.tradingName,
          cnpj: record.cnpj,
          ticker,
          isin: item.isin ?? "",
          shareClass: getShareClass(ticker),
          mainTicker: record.detail.code ?? "",
          website: record.detail.website ?? "",
          hasQuotation: record.detail.hasQuotation ?? "",
          b3Market: record.detail.market ?? "",
          segment: record.segment,
          industryClassification: record.detail.industryClassification ?? "",
          activity: record.detail.activity ?? "",
        });
      }
    }

    const payload = {
      source: "B3",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: securities.length,
      securities,
    };

    await fs.mkdir(B3_DIR, { recursive: true });
    await fs.writeFile(
      SECURITIES_FILE,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not build B3 securities file",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
