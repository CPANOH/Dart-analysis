/**
 * DART corpCode.xml을 내려받아 "상장사(stock_code 존재)" 매핑만 추려
 * app/data/corpcodes.json 으로 저장한다.
 *
 * DART는 클라우드 IP로의 corpCode.xml(3.5MB) 다운로드를 심하게 스로틀링해서
 * Vercel 런타임에서는 받을 수 없다. 그래서 이 파일을 로컬(다운로드가 빠른 환경)에서
 * 미리 실행해 결과 JSON을 저장소에 커밋하고, 앱은 그 JSON을 번들로 읽는다.
 *
 * 사용법:  DART_API_KEY=... node scripts/gen-corpcodes.mjs
 *   (키를 안 주면 .env.local 에서 읽는다)
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function getKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY.trim();
  const envPath = path.join(ROOT, ".env.local");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^DART_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("DART_API_KEY가 필요합니다 (환경변수 또는 .env.local).");
}

function download(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("리다이렉트가 너무 많습니다."));
    const opts = { timeout: 60000, headers: { "User-Agent": "curl/8.0" } };
    https.get(url, opts, (res) => {
      // DART는 User-Agent/조건에 따라 302로 실제 파일 URL을 준다 — 따라간다.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, depth + 1));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

const key = getKey();
console.log("corpCode.xml 다운로드 중...");
const buffer = await download(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`);
console.log(`  받은 크기: ${buffer.length} bytes`);

const zip = new AdmZip(buffer);
const xml = zip.getEntries()[0].getData().toString("utf-8");
const parser = new XMLParser({ parseTagValue: false });
const list = parser.parse(xml)?.result?.list ?? [];
const arr = Array.isArray(list) ? list : [list];

const listed = arr
  .map((c) => ({
    corp_code: String(c.corp_code ?? "").trim(),
    corp_name: String(c.corp_name ?? "").trim(),
    stock_code: String(c.stock_code ?? "").trim(),
  }))
  .filter((c) => c.stock_code && c.corp_code);

console.log(`  전체 ${arr.length}건 중 상장사 ${listed.length}건 추출`);

const outDir = path.join(ROOT, "app", "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "corpcodes.json");
fs.writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), companies: listed }),
  "utf-8"
);
console.log(`저장 완료: ${outPath} (${fs.statSync(outPath).size} bytes)`);
