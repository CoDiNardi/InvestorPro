import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type CachedCompany = {
  codeCVM: string;
  issuingCompany: string;
  companyName: string;
  tradingName: string;
  cnpj: string;
  marketIndicator: string;
  typeBDR: string;
  dateListing: string;
  status: string;
  segment: string;
};

type DetailResult =
  | {
      codeCVM: string;
      companyName: string;
      tradingName: string;
      cnpj: string;
      marketIndicator: string;
      segment: string;
      detail: unknown;
    }
  | {
      codeCVM: string;
      companyName: string;
      tradingName: string;
      cnpj: string;
      marketIndicator: string;
      segment: string;
      error: string;
    };

const OPERATING_COMPANY_MARKET_INDICATORS = ["16", "17", "18"];

const B3_DIR = path.join(process.cwd(), "data", "markets", "b3");
const COMPANIES_FILE = path.join(B3_DIR, "companies.json");
const DETAILS_FILE = path.join(B3_DIR, "company-details.json");

function encodeB3Payload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function readCompaniesCache() {
  const file = await fs.readFile(COMPANIES_FILE, "utf-8");
  return JSON.parse(file);
}

async function fetchB3CompanyDetail(codeCVM: string) {
  const payload = {
    codeCVM,
    language: "pt-br",
  };

  const encoded = encodeB3Payload(payload);

  const url =
    `https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetDetail/${encoded}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "InvestorPro/1.0",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`B3 detail request failed for CVM ${codeCVM}: ${response.status}`);
  }

  const raw = await response.json();

  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

export async function POST() {
  try {
    const companiesCache = await readCompaniesCache();

    const companies: CachedCompany[] = companiesCache.companies ?? [];

    const targetCompanies = companies.filter((company) =>
      OPERATING_COMPANY_MARKET_INDICATORS.includes(company.marketIndicator)
    );

    const batches = chunkArray(targetCompanies, 10);
    const details: DetailResult[] = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (company): Promise<DetailResult> => {
          try {
            const detail = await fetchB3CompanyDetail(company.codeCVM);

            return {
              codeCVM: company.codeCVM,
              companyName: company.companyName,
              tradingName: company.tradingName,
              cnpj: company.cnpj,
              marketIndicator: company.marketIndicator,
              segment: company.segment,
              detail,
            };
          } catch (error) {
            return {
              codeCVM: company.codeCVM,
              companyName: company.companyName,
              tradingName: company.tradingName,
              cnpj: company.cnpj,
              marketIndicator: company.marketIndicator,
              segment: company.segment,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      details.push(...batchResults);
    }

    const payload = {
      source: "B3",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: details.length,
      successCount: details.filter((item) => !("error" in item)).length,
      errorCount: details.filter((item) => "error" in item).length,
      details,
    };

    await fs.mkdir(B3_DIR, { recursive: true });
    await fs.writeFile(DETAILS_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not update B3 company details",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
