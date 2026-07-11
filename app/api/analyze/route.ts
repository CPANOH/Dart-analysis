import { NextRequest, NextResponse } from "next/server";
import { analyzeCompany, CompanyResult } from "@/app/lib/dart";
import { buildWorkbook } from "@/app/lib/excel";

export const maxDuration = 60;
// DART(전자공시시스템)는 한국 소재 서버이므로 서울 리전에서 실행해 지연을 줄인다.
export const preferredRegion = "icn1";

function currentDefaultYears(): number[] {
  const y = new Date().getFullYear() - 1;
  return [y, y - 1, y - 2];
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "서버에 DART_API_KEY 환경변수가 설정되어 있지 않습니다." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const companies: string[] = (body?.companies ?? []).filter(
    (c: unknown) => typeof c === "string" && c.trim()
  );
  const years: number[] =
    Array.isArray(body?.years) && body.years.length === 3
      ? body.years.map((y: unknown) => Number(y))
      : currentDefaultYears();

  if (companies.length < 1 || companies.length > 3) {
    return NextResponse.json({ error: "회사명을 1~3개 입력하세요." }, { status: 400 });
  }

  let results: CompanyResult[];
  try {
    results = await Promise.all(
      companies.map((name) => analyzeCompany(apiKey, name.trim(), years))
    );
  } catch (err) {
    return NextResponse.json(
      { error: `DART 조회 중 오류가 발생했습니다: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const warnings = results.flatMap((r) => r.warnings);
  const usable = results.filter((r) => !r.notFound && Object.keys(r.byYear).length);

  if (!usable.length) {
    return NextResponse.json(
      { error: "조회된 데이터가 없습니다.", warnings },
      { status: 404 }
    );
  }

  const buffer = await buildWorkbook(results);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const filename = `재무분석_${timestamp}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "X-Warnings": encodeURIComponent(JSON.stringify(warnings)),
    },
  });
}
