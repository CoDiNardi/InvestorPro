import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type B3Company = {
  codeCVM?: string;
  issuingCompany?: string;
  companyName?: string;
  tradingName?: string;
  cnpj?: string;
  marketIndicator?: string;
  typeBDR?: string;
  dateListing?: string;
  status?: string;
  segment?: string;
  [key: string]: unknown;
};

const DATA_DIR = path.join(process.cwd(), "data", "markets", "b3");
const DATA_FILE = path.join(DATA_DIR, "companies.json");

function encodeB3Payload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function fetchB3Page(pageNumber: number, pageSize: number) {
  const payload = {
    language: "pt-br",
    pageNumber,
    pageSize,
  };

  const encoded = encodeB3Payload(payload);

  const url =
    `https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/${encoded}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "InvestorPro/1.0",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`B3 request failed: ${response.status}`);
  }

  return response.json();
}

export async function POST() {
  try {
    const pageSize = 120;
    const firstPage = await fetchB3Page(1, pageSize);

    const totalPages =
      firstPage?.page?.totalPages ??
      firstPage?.totalPages ??
      1;

    const companies: B3Company[] = [
      ...(firstPage?.results ?? firstPage?.companies ?? []),
    ];

    for (let page = 2; page <= totalPages; page++) {
      const data = await fetchB3Page(page, pageSize);
      companies.push(...(data?.results ?? data?.companies ?? []));
    }

    const normalized = companies.map((company) => ({
      codeCVM: company.codeCVM ?? "",
      issuingCompany: company.issuingCompany ?? "",
      companyName: company.companyName ?? "",
      tradingName: company.tradingName ?? "",
      cnpj: company.cnpj ?? "",
      marketIndicator: company.marketIndicator ?? "",
      typeBDR: company.typeBDR ?? "",
      dateListing: company.dateListing ?? "",
      status: company.status ?? "",
      segment: company.segment ?? "",
      raw: company,
    }));

    const payload = {
      source: "B3",
      market: "b3",
      updatedAt: new Date().toISOString(),
      count: normalized.length,
      companies: normalized,
    };

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf-8");

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not update B3 companies",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
