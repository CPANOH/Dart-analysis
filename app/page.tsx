"use client";

import { useState } from "react";

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

export default function Home() {
  const [companies, setCompanies] = useState(["", "", ""]);
  const [years, setYears] = useState<number[]>(DEFAULT_YEARS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const updateCompany = (idx: number, value: string) => {
    setCompanies((prev) => prev.map((c, i) => (i === idx ? value : c)));
  };

  const updateYear = (idx: number, value: string) => {
    const n = Number(value);
    setYears((prev) => prev.map((y, i) => (i === idx ? (Number.isFinite(n) ? n : y) : y)));
  };

  const handleSubmit = async () => {
    const names = companies.map((c) => c.trim()).filter(Boolean);
    if (names.length === 0) {
      setError("회사명을 최소 1개 이상 입력하세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: names, years }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `요청 실패 (HTTP ${res.status})`);
        if (data.warnings) setWarnings(data.warnings);
        return;
      }

      const warningsHeader = res.headers.get("X-Warnings");
      if (warningsHeader) {
        try {
          setWarnings(JSON.parse(decodeURIComponent(warningsHeader)));
        } catch {
          /* ignore */
        }
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? decodeURIComponent(match[1]) : "재무분석.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`요청 중 오류가 발생했습니다: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            재무제표 비교 분석기
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            DART 전자공시시스템 기준으로 최대 3개 기업의 3개년 재무제표를 비교해 엑셀로
            다운로드합니다.
          </p>
        </div>

        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              회사명 (최대 3개)
            </label>
            {companies.map((c, idx) => (
              <input
                key={idx}
                value={c}
                onChange={(e) => updateCompany(idx, e.target.value)}
                placeholder={`회사명 ${idx + 1}`}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              조회 연도 (사업보고서 기준)
            </label>
            <div className="flex gap-2">
              {years.map((y, idx) => (
                <input
                  key={idx}
                  type="number"
                  value={y}
                  onChange={(e) => updateYear(idx, e.target.value)}
                  className="w-24 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="mt-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {loading ? "분석 중..." : "분석하고 엑셀 다운로드"}
          </button>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
