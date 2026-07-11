import { NextRequest, NextResponse } from "next/server";
import { searchCompanies } from "@/app/lib/industry";
import { searchByIndustryRanked } from "@/app/lib/naverIndustry";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const industry = searchParams.get("industry") ?? "";
  const name = searchParams.get("name") ?? "";

  try {
    if (industry.trim()) {
      const ranked = await searchByIndustryRanked(industry, name, 20);
      if (ranked !== null) {
        return NextResponse.json({
          results: ranked.map((r) => ({ name: r.name, industry: industry.trim() })),
        });
      }
      // 업종 키워드와 매칭되는 카테고리가 없으면 회사명 기반 검색으로 폴백한다.
    }

    const results = await searchCompanies(industry, name, 30);
    return NextResponse.json({
      results: results.map((r) => ({ name: r.name, industry: r.industry })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `상장사 목록 조회 중 오류가 발생했습니다: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}
