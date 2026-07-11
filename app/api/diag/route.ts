import { NextResponse } from "next/server";
import https from "node:https";

export const maxDuration = 60;
export const preferredRegion = "icn1";

const KEY = process.env.DART_API_KEY ?? "";
const BASE = "https://opendart.fss.or.kr/api";
const CORP_URL = `${BASE}/corpCode.xml?crtfc_key=${KEY}`;
// 삼성전자 corp_code=00126380, 2023 사업보고서
const FIN_URL = `${BASE}/fnlttSinglAcnt.json?crtfc_key=${KEY}&corp_code=00126380&bsns_year=2023&reprt_code=11011`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Connection: "close",
};

// 실제 앱의 httpsGet과 동일한 옵션으로 요청
function httpsGet(url: string, opts: https.RequestOptions, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ...opts, timeout: timeoutMs }, (res) => {
      let n = 0;
      res.on("data", (c) => (n += c.length));
      res.on("end", () => resolve(`status=${res.statusCode} bytes=${n}`));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`socket timeout ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

function timed(label: string, p: Promise<string>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  return p
    .then((v) => ({ label, ok: true, ms: Date.now() - t0, info: v }))
    .catch((e) => ({ label, ok: false, ms: Date.now() - t0, error: (e as Error).message }));
}

export async function GET() {
  // 앱과 동일: User-Agent + Connection:close + IPv4
  const corp = await timed("corp_headers_v4", httpsGet(CORP_URL, { headers: HEADERS, family: 4 }));
  const fin = await timed("fin_headers_v4", httpsGet(FIN_URL, { headers: HEADERS, family: 4 }));
  // 헤더 없이 기본
  const corpNoHdr = await timed("corp_nohdr_default", httpsGet(CORP_URL, {}));
  return NextResponse.json({ keyLen: KEY.length, corp, fin, corpNoHdr });
}
