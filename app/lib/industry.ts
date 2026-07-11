import iconv from "iconv-lite";

// KIND(한국거래소 기업공시채널) 상장법인목록 다운로드.
// data.krx.co.kr의 시가총액 API는 세션 쿠키가 없으면 "LOGOUT"을 반환하는 봇 차단이 있어
// 서버리스 환경에서 안정적으로 우회하기 어렵다. 이 앱은 순위가 아니라 "업종으로 1차 필터,
// 회사명으로 2차 필터"만 필요하므로 시가총액 없이 이 KIND 엔드포인트만으로 충분하다.
const CORP_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";

export interface IndustryEntry {
  name: string;
  stockCode: string;
  industry: string;
  products: string;
}

let cache: { entries: IndustryEntry[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 1일

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseCorpListHtml(html: string): IndustryEntry[] {
  const rows = html.split(/<tr[^>]*>/i).slice(1); // 첫 조각은 <tr> 이전(헤더 등)
  const entries: IndustryEntry[] = [];

  for (const row of rows) {
    const bodyMatch = row.split(/<\/tr>/i)[0];
    if (!bodyMatch) continue;
    const cells = [...bodyMatch.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1])
    );
    // 컬럼: 회사명, 시장구분, 종목코드, 업종, 주요제품, 상장일, 결산월, 대표자명, 홈페이지, 지역
    if (cells.length < 5) continue;
    const [name, , stockCode, industry, products] = cells;
    if (!name || !stockCode) continue;
    entries.push({ name, stockCode, industry, products });
  }

  return entries;
}

async function fetchIndustryList(): Promise<IndustryEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.entries;
  }

  const res = await fetch(CORP_LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`KRX 상장법인목록 다운로드 실패 (HTTP ${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buffer, "euc-kr");
  const entries = parseCorpListHtml(html);
  if (!entries.length) {
    throw new Error("KRX 상장법인목록을 파싱하지 못했습니다.");
  }

  cache = { entries, fetchedAt: Date.now() };
  return entries;
}

/**
 * 1차 필터(업종) → 2차 필터(회사명) 순으로 상장사를 좁혀서 반환한다.
 * 두 키워드 모두 없으면 KRX 전체 상장법인목록에서 limit개만 잘라 반환한다.
 */
export async function searchCompanies(
  industryKeyword: string,
  nameKeyword: string,
  limit = 30
): Promise<IndustryEntry[]> {
  const entries = await fetchIndustryList();
  const industryQ = industryKeyword.trim();
  const nameQ = nameKeyword.trim();

  let result = entries;
  if (industryQ) {
    result = result.filter(
      (e) => e.industry.includes(industryQ) || e.products.includes(industryQ)
    );
  }
  if (nameQ) {
    result = result.filter((e) => e.name.includes(nameQ));
  }

  return result.slice(0, limit);
}
