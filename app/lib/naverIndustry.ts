import iconv from "iconv-lite";

// 네이버 증권 "업종별시세"로 1차 필터(업종)를, 실시간 시세 API의 시가총액으로
// 상위 랭킹을 매긴다. KRX data.krx.co.kr의 시가총액 API는 세션 쿠키 없이는
// "LOGOUT"을 반환하는 봇 차단이 있어(서버리스 환경에서 안정적으로 우회하기 어려움),
// 네이버 증권 쪽이 더 간단하고 안정적이다.
const UPJONG_LIST_URL = "https://finance.naver.com/sise/sise_group.naver?type=upjong";
const UPJONG_DETAIL_URL = "https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=";
const REALTIME_URL = "https://polling.finance.naver.com/api/realtime/domestic/stock/";

const HEADERS = { "User-Agent": "Mozilla/5.0" };

export interface IndustryCategory {
  code: string;
  name: string;
}

export interface RankedCompany {
  code: string;
  name: string;
  marketCap: number;
}

let categoryCache: { entries: IndustryCategory[]; fetchedAt: number } | null = null;
const CATEGORY_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7일

const companyListCache = new Map<string, { entries: { code: string; name: string }[]; fetchedAt: number }>();
const COMPANY_LIST_TTL_MS = 1000 * 60 * 60 * 24; // 1일

async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`네이버 증권 조회 실패 (HTTP ${res.status}): ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buffer, "euc-kr");
}

async function getIndustryCategories(): Promise<IndustryCategory[]> {
  if (categoryCache && Date.now() - categoryCache.fetchedAt < CATEGORY_TTL_MS) {
    return categoryCache.entries;
  }
  const html = await fetchEucKr(UPJONG_LIST_URL);
  const entries = [...html.matchAll(/sise_group_detail\.naver\?type=upjong&no=(\d+)"[^>]*>([^<]+)</g)].map(
    (m) => ({ code: m[1], name: m[2].trim() })
  );
  if (!entries.length) {
    throw new Error("네이버 증권 업종 목록을 파싱하지 못했습니다.");
  }
  categoryCache = { entries, fetchedAt: Date.now() };
  return entries;
}

// 우선주(회사명우, 회사명우B 등)는 DART 상으로는 보통주와 같은 법인이라 후보 목록에서 뺀다.
function filterOutPreferredShares(
  companies: { code: string; name: string }[]
): { code: string; name: string }[] {
  const names = new Set(companies.map((c) => c.name));
  return companies.filter((c) => {
    const m = c.name.match(/^(.+?)(\d?우[A-Z]?)$/);
    if (m && names.has(m[1])) return false;
    return true;
  });
}

async function getCompaniesForCategory(code: string): Promise<{ code: string; name: string }[]> {
  const cached = companyListCache.get(code);
  if (cached && Date.now() - cached.fetchedAt < COMPANY_LIST_TTL_MS) {
    return cached.entries;
  }
  const html = await fetchEucKr(`${UPJONG_DETAIL_URL}${code}`);
  const raw = [...html.matchAll(/<a href="\/item\/main\.naver\?code=(\d{6}[A-Z]?)"[^>]*>([^<]+)<\/a>/g)].map(
    (m) => ({ code: m[1], name: m[2].trim() })
  );
  const entries = filterOutPreferredShares(raw);
  companyListCache.set(code, { entries, fetchedAt: Date.now() });
  return entries;
}

async function getMarketCaps(codes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const chunkSize = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += chunkSize) {
    chunks.push(codes.slice(i, i + chunkSize));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`${REALTIME_URL}${chunk.join(",")}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      for (const item of data?.datas ?? []) {
        const raw = Number(item.marketValueFullRaw);
        if (item.itemCode && Number.isFinite(raw)) {
          result.set(item.itemCode, raw);
        }
      }
    })
  );

  return result;
}

/**
 * 1차 필터(업종 키워드) → 시가총액 상위 topN → 2차 필터(회사명 키워드) 순으로 좁힌다.
 * 업종에 매칭되는 카테고리가 없으면 null을 반환한다(호출부에서 다른 검색으로 폴백하도록).
 */
export async function searchByIndustryRanked(
  industryKeyword: string,
  nameKeyword: string,
  topN = 20
): Promise<RankedCompany[] | null> {
  const categories = await getIndustryCategories();
  const matchedCategories = categories.filter((c) => c.name.includes(industryKeyword.trim()));
  if (!matchedCategories.length) {
    return null;
  }

  const companyLists = await Promise.all(matchedCategories.map((c) => getCompaniesForCategory(c.code)));
  const byCode = new Map<string, string>();
  for (const list of companyLists) {
    for (const c of list) byCode.set(c.code, c.name);
  }
  if (!byCode.size) return [];

  const marketCaps = await getMarketCaps([...byCode.keys()]);

  let ranked: RankedCompany[] = [...byCode.entries()]
    .map(([code, name]) => ({ code, name, marketCap: marketCaps.get(code) ?? 0 }))
    .sort((a, b) => b.marketCap - a.marketCap);

  ranked = ranked.slice(0, topN);

  const nameQ = nameKeyword.trim();
  if (nameQ) {
    ranked = ranked.filter((c) => c.name.includes(nameQ));
  }

  return ranked;
}
