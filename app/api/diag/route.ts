import { NextResponse } from "next/server";
import https from "node:https";

export const maxDuration = 60;
export const preferredRegion = "icn1";

const KEY = process.env.DART_API_KEY ?? "";
const BASE = "https://opendart.fss.or.kr/api";
const CORP_URL = `${BASE}/corpCode.xml?crtfc_key=${KEY}`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 벽시계 하드 타임아웃: 느리게 트리클되는 다운로드도 hardMs에 잘라내고 그때까지 받은 바이트를 보고한다.
function probe(
  label: string,
  url: string,
  opts: https.RequestOptions,
  hardMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let n = 0;
    let status = 0;
    let done = false;
    const finish = (extra: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        req.destroy();
      } catch {}
      resolve({ label, ms: Date.now() - t0, bytes: n, status, ...extra });
    };
    const timer = setTimeout(() => finish({ cut: `hard timeout ${hardMs}ms` }), hardMs);
    const req = https.get(url, opts, (res) => {
      status = res.statusCode ?? 0;
      res.on("data", (c) => (n += c.length));
      res.on("end", () => finish({ ok: true }));
      res.on("error", (e) => finish({ error: (e as Error).message }));
    });
    req.on("error", (e) => finish({ error: (e as Error).message }));
  });
}

export async function GET() {
  const withUA = await probe("corp_withUA_v4", CORP_URL, { headers: { "User-Agent": UA }, family: 4 }, 25000);
  const noUA = await probe("corp_noUA_v4", CORP_URL, { family: 4 }, 25000);
  return NextResponse.json({ keyLen: KEY.length, withUA, noUA });
}
