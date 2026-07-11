import { NextResponse } from "next/server";
import https from "node:https";

export const maxDuration = 60;
export const preferredRegion = "icn1";

const KEY = process.env.DART_API_KEY ?? "";
const URL_CORP = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${KEY}`;

function timed<T>(label: string, p: Promise<T>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  return p
    .then((v) => ({ label, ok: true, ms: Date.now() - t0, info: String(v).slice(0, 80) }))
    .catch((e) => ({ label, ok: false, ms: Date.now() - t0, error: (e as Error).message }));
}

// 방법 A: 표준 fetch (18초 abort)
function viaFetch(): Promise<string> {
  return fetch(URL_CORP, { signal: AbortSignal.timeout(18000) }).then(
    async (r) => `status=${r.status} bytes=${(await r.arrayBuffer()).byteLength}`
  );
}

// 방법 B: node:https + IPv4 강제 (18초)
function viaHttpsV4(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(URL_CORP, { timeout: 18000, family: 4 }, (res) => {
      let n = 0;
      res.on("data", (c) => (n += c.length));
      res.on("end", () => resolve(`status=${res.statusCode} bytes=${n}`));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("socket timeout 18s")));
    req.on("error", reject);
  });
}

// 방법 C: node:https 기본(IPv6 허용) (18초)
function viaHttpsDefault(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(URL_CORP, { timeout: 18000 }, (res) => {
      let n = 0;
      res.on("data", (c) => (n += c.length));
      res.on("end", () => resolve(`status=${res.statusCode} bytes=${n}`));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("socket timeout 18s")));
    req.on("error", reject);
  });
}

export async function GET() {
  const results = await Promise.all([
    timed("fetch", viaFetch()),
    timed("https_ipv4", viaHttpsV4()),
    timed("https_default", viaHttpsDefault()),
  ]);
  return NextResponse.json({ keyLen: KEY.length, results });
}
