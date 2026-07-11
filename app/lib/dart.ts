import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const BASE_URL = "https://opendart.fss.or.kr/api";
const REPRT_CODE_ANNUAL = "11011";

export const ACCOUNT_MAP: Record<string, string[]> = {
  매출액: ["매출액", "매출액(수익)", "수익(매출액)", "영업수익", "매출"],
  영업이익: ["영업이익", "영업이익(손실)"],
  당기순이익: [
    "당기순이익",
    "당기순이익(손실)",
    "당기순이익(손실)(A)",
    "분기순이익",
    "반기순이익",
  ],
  자산총계: ["자산총계"],
  부채총계: ["부채총계"],
  자본총계: ["자본총계"],
};

// 계정명이 동일해도 재무제표구분(sj_div)별로 중복 등장할 수 있어(예: 손익계산서 vs 자본변동표)
// 우선적으로 찾아야 할 sj_div 순서를 지정한다.
const SJ_DIV_PREFERENCE: Record<string, string[]> = {
  매출액: ["IS", "CIS"],
  영업이익: ["IS", "CIS"],
  당기순이익: ["IS", "CIS"],
  자산총계: ["BS"],
  부채총계: ["BS"],
  자본총계: ["BS"],
};

export type Metrics = Record<string, number | null>;
export type Ratios = Record<string, number | null>;

export interface YearData {
  metrics: Metrics;
  ratios: Ratios;
  fsDiv: string;
}

export interface CompanyResult {
  requestedName: string;
  resolvedName: string;
  byYear: Record<number, YearData>;
  notFound?: boolean;
  warnings: string[];
}

interface CorpEntry {
  corp_code: string;
  corp_name: string;
  stock_code: string;
}

let corpListCache: { entries: CorpEntry[]; fetchedAt: number } | null = null;
const CORP_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7일

async function getCorpList(apiKey: string): Promise<CorpEntry[]> {
  if (corpListCache && Date.now() - corpListCache.fetchedAt < CORP_CACHE_TTL_MS) {
    return corpListCache.entries;
  }

  const res = await fetch(`${BASE_URL}/corpCode.xml?crtfc_key=${apiKey}`);
  if (!res.ok) {
    throw new Error(`corpCode 다운로드 실패 (HTTP ${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  let xml: string;
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries()[0];
    xml = entry.getData().toString("utf-8");
  } catch {
    throw new Error(
      `corpCode 응답이 zip 형식이 아닙니다. API 키를 확인하세요. 응답: ${buffer
        .toString("utf-8")
        .slice(0, 300)}`
    );
  }

  const parser = new XMLParser({ parseTagValue: false });
  const parsed = parser.parse(xml);
  const list = parsed?.result?.list ?? [];
  const entries: CorpEntry[] = (Array.isArray(list) ? list : [list]).map((c) => ({
    corp_code: String(c.corp_code ?? "").trim(),
    corp_name: String(c.corp_name ?? "").trim(),
    stock_code: String(c.stock_code ?? "").trim(),
  }));

  corpListCache = { entries, fetchedAt: Date.now() };
  return entries;
}

function findCorpCode(
  entries: CorpEntry[],
  companyName: string
): { corpCode: string; name: string } | null {
  const exactListed: CorpEntry[] = [];
  const exactAny: CorpEntry[] = [];
  const partial: CorpEntry[] = [];

  for (const c of entries) {
    if (c.corp_name === companyName) {
      (c.stock_code ? exactListed : exactAny).push(c);
    } else if (c.corp_name.includes(companyName)) {
      partial.push(c);
    }
  }

  const candidates = exactListed.length ? exactListed : exactAny.length ? exactAny : partial;
  if (!candidates.length) return null;

  candidates.sort((a, b) => (a.stock_code ? 0 : 1) - (b.stock_code ? 0 : 1));
  const best = candidates[0];
  return { corpCode: best.corp_code, name: best.corp_name };
}

interface DartAccountRow {
  account_nm: string;
  thstrm_amount: string;
  sj_div: string;
}

async function fetchFinancials(
  apiKey: string,
  corpCode: string,
  year: number,
  fsDiv: "CFS" | "OFS"
): Promise<{ rows: DartAccountRow[]; usedDiv: string }> {
  const divsToTry = fsDiv === "CFS" ? ["CFS", "OFS"] : [fsDiv];

  for (const div of divsToTry) {
    const params = new URLSearchParams({
      crtfc_key: apiKey,
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: REPRT_CODE_ANNUAL,
      fs_div: div,
    });
    const res = await fetch(`${BASE_URL}/fnlttSinglAcntAll.json?${params.toString()}`);
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === "000") {
      return { rows: data.list as DartAccountRow[], usedDiv: div };
    }
  }
  return { rows: [], usedDiv: fsDiv };
}

function findAccountRow(
  rows: DartAccountRow[],
  candidates: string[],
  sjDivPreference: string[]
): DartAccountRow | undefined {
  for (const sjDiv of sjDivPreference) {
    const match = rows.find(
      (r) => r.sj_div === sjDiv && candidates.includes((r.account_nm || "").trim())
    );
    if (match) return match;
  }
  return rows.find((r) => candidates.includes((r.account_nm || "").trim()));
}

function extractKeyAccounts(rows: DartAccountRow[]): Metrics {
  const result: Metrics = {};
  for (const [displayName, candidates] of Object.entries(ACCOUNT_MAP)) {
    const match = findAccountRow(rows, candidates, SJ_DIV_PREFERENCE[displayName] ?? []);
    if (match) {
      const cleaned = (match.thstrm_amount || "0").replace(/,/g, "");
      const n = Number(cleaned);
      result[displayName] = Number.isFinite(n) ? n : null;
    } else {
      result[displayName] = null;
    }
  }
  return result;
}

function pct(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || !denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function computeRatios(metrics: Metrics): Ratios {
  return {
    "영업이익률(%)": pct(metrics["영업이익"], metrics["매출액"]),
    "순이익률(%)": pct(metrics["당기순이익"], metrics["매출액"]),
    "부채비율(%)": pct(metrics["부채총계"], metrics["자본총계"]),
    "ROE(%)": pct(metrics["당기순이익"], metrics["자본총계"]),
    "ROA(%)": pct(metrics["당기순이익"], metrics["자산총계"]),
  };
}

export async function analyzeCompany(
  apiKey: string,
  companyName: string,
  years: number[],
  fsDiv: "CFS" | "OFS" = "CFS"
): Promise<CompanyResult> {
  const warnings: string[] = [];
  const entries = await getCorpList(apiKey);
  const found = findCorpCode(entries, companyName);

  if (!found) {
    return {
      requestedName: companyName,
      resolvedName: companyName,
      byYear: {},
      notFound: true,
      warnings: [`'${companyName}'에 해당하는 기업을 찾을 수 없습니다.`],
    };
  }

  const byYear: Record<number, YearData> = {};
  for (const year of years) {
    const { rows, usedDiv } = await fetchFinancials(apiKey, found.corpCode, year, fsDiv);
    if (!rows.length) {
      warnings.push(`${found.name} ${year}년 재무제표 데이터를 찾을 수 없습니다.`);
      continue;
    }
    const metrics = extractKeyAccounts(rows);
    const ratios = computeRatios(metrics);
    byYear[year] = { metrics, ratios, fsDiv: usedDiv };
  }

  return { requestedName: companyName, resolvedName: found.name, byYear, warnings };
}

export const METRIC_ROWS = Object.keys(ACCOUNT_MAP);
export const RATIO_ROWS = ["영업이익률(%)", "순이익률(%)", "부채비율(%)", "ROE(%)", "ROA(%)"];
