import https from "node:https";
import corpData from "@/app/data/corpcodes.json";

const BASE_URL = "https://opendart.fss.or.kr/api";
const REPRT_CODE_ANNUAL = "11011";
// DART 서버는 User-Agent가 없는 요청을 응답 없이 드롭하는 경우가 있어 브라우저형 UA를 지정한다.
const DART_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Connection: "close",
};

// Vercel의 Node.js fetch(undici)가 opendart.fss.or.kr의 일부 엔드포인트에서 응답을
// 받지 못하고 멈추는 현상이 있어, node:https 모듈로 직접 요청해 우회한다.
function httpsGet(url: string, timeoutMs = 15000): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // family: 4 → IPv6 경로가 응답 없이 멈추는 환경(일부 서버리스 네트워크)을 우회하기 위해 IPv4를 강제한다.
    const req = https.get(url, { headers: DART_HEADERS, timeout: timeoutMs, family: 4 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

// fnlttSinglAcnt(단일회사 주요계정)는 DART가 전 기업에 표준화해 제공하는 요약 계정과목이라
// fnlttSinglAcntAll(전체 재무제표, 기업마다 XBRL 계정명이 제각각)보다 매칭이 안정적이다.
export const ACCOUNT_MAP: Record<string, string[]> = {
  매출액: ["매출액", "매출액(수익)", "수익(매출액)", "영업수익", "매출"],
  영업이익: ["영업이익", "영업이익(손실)"],
  당기순이익: ["당기순이익(손실)", "당기순이익", "분기순이익", "반기순이익"],
  자산총계: ["자산총계"],
  부채총계: ["부채총계"],
  자본총계: ["자본총계"],
};

const SJ_DIV_PREFERENCE: Record<string, string[]> = {
  매출액: ["IS", "CIS"],
  영업이익: ["IS", "CIS"],
  당기순이익: ["IS", "CIS"],
  자산총계: ["BS"],
  부채총계: ["BS"],
  자본총계: ["BS"],
};

// fnlttSinglAcnt는 연결(CFS)·별도(OFS) 재무제표를 한 응답에 함께 반환하므로, 연결 우선으로 고른다.
const FS_DIV_PREFERENCE = ["CFS", "OFS"];

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

// DART는 클라우드 IP로의 corpCode.xml(3.5MB) 다운로드를 극심하게 스로틀링(~14KB/s)해서
// Vercel 런타임에서는 사실상 받을 수 없다. 그래서 상장사 corp_code 매핑을 빌드 타임에 미리
// 받아 저장한 번들(app/data/corpcodes.json)을 읽는다.
// 갱신: `node scripts/gen-corpcodes.mjs` 실행 후 커밋.
const corpEntries: CorpEntry[] = (corpData.companies as CorpEntry[]) ?? [];

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
  fs_div: string;
}

async function fetchFinancials(
  apiKey: string,
  corpCode: string,
  year: number
): Promise<DartAccountRow[]> {
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: REPRT_CODE_ANNUAL,
  });
  const t0 = Date.now();
  let status = 0;
  let data: { status?: string; list?: DartAccountRow[] } | null = null;
  try {
    const { status: s, body } = await httpsGet(`${BASE_URL}/fnlttSinglAcnt.json?${params.toString()}`);
    status = s;
    data = status === 200 ? JSON.parse(body.toString("utf-8")) : null;
  } catch (err) {
    console.log(
      `[dart] fnlttSinglAcnt ${corpCode} ${year} FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`
    );
    return [];
  }
  console.log(
    `[dart] fnlttSinglAcnt ${corpCode} ${year}: ${Date.now() - t0}ms, status=${status}, dartStatus=${data?.status}`
  );
  if (status !== 200 || !data || data.status !== "000") return [];
  return (data.list ?? []) as DartAccountRow[];
}

function findAccountRow(
  rows: DartAccountRow[],
  candidates: string[],
  sjDivPreference: string[]
): DartAccountRow | undefined {
  for (const fsDiv of FS_DIV_PREFERENCE) {
    for (const sjDiv of sjDivPreference) {
      const match = rows.find(
        (r) =>
          r.fs_div === fsDiv &&
          r.sj_div === sjDiv &&
          candidates.includes((r.account_nm || "").trim())
      );
      if (match) return match;
    }
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
  years: number[]
): Promise<CompanyResult> {
  const warnings: string[] = [];
  const found = findCorpCode(corpEntries, companyName);

  if (!found) {
    return {
      requestedName: companyName,
      resolvedName: companyName,
      byYear: {},
      notFound: true,
      warnings: [`'${companyName}'에 해당하는 기업을 찾을 수 없습니다.`],
    };
  }

  // 연도별 조회를 병렬로 돌린다. 순차 조회 시 DART 응답이 느려지면 지연이 그대로
  // 누적되어(최대 10개년 × 15초 타임아웃) Vercel 함수 제한(60초)을 넘기기 쉬웠다.
  // 병렬화하면 최악의 경우도 "가장 느린 호출 1건"만큼만 걸린다.
  const byYear: Record<number, YearData> = {};
  const yearResults = await Promise.all(
    years.map(async (year) => {
      const rows = await fetchFinancials(apiKey, found.corpCode, year);
      return { year, rows };
    })
  );
  for (const { year, rows } of yearResults) {
    if (!rows.length) {
      warnings.push(`${found.name} ${year}년 재무제표 데이터를 찾을 수 없습니다.`);
      continue;
    }
    const metrics = extractKeyAccounts(rows);
    const ratios = computeRatios(metrics);
    const usedDiv = rows.some((r) => r.fs_div === "CFS") ? "CFS" : "OFS";
    byYear[year] = { metrics, ratios, fsDiv: usedDiv };
  }

  return { requestedName: companyName, resolvedName: found.name, byYear, warnings };
}

export const METRIC_ROWS = Object.keys(ACCOUNT_MAP);
export const RATIO_ROWS = ["영업이익률(%)", "순이익률(%)", "부채비율(%)", "ROE(%)", "ROA(%)"];
