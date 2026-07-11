"use client";

import { useEffect, useState } from "react";

const MAX_COMPANIES = 5;
const MAX_YEARS = 10;

interface CompanyOption {
  name: string;
  industry: string;
}

export default function Home() {
  const [industryQuery, setIndustryQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [candidates, setCandidates] = useState<CompanyOption[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [yearCount, setYearCount] = useState(MAX_YEARS);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // 1차(업종) → 2차(회사명) 필터로 후보 목록을 좁혀서 보여준다 (디바운스).
  useEffect(() => {
    const handle = setTimeout(async () => {
      setCandidatesLoading(true);
      setCandidatesError(null);
      try {
        const params = new URLSearchParams();
        if (industryQuery.trim()) params.set("industry", industryQuery.trim());
        if (nameQuery.trim()) params.set("name", nameQuery.trim());
        const res = await fetch(`/api/companies?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setCandidatesError(data.error || "후보 조회 실패");
          setCandidates([]);
          return;
        }
        setCandidates(data.results);
      } catch (e) {
        setCandidatesError(`후보 조회 중 오류: ${(e as Error).message}`);
        setCandidates([]);
      } finally {
        setCandidatesLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [industryQuery, nameQuery]);

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= MAX_COMPANIES) return prev;
      return [...prev, name];
    });
  };

  const handleSubmit = async () => {
    if (selected.length === 0) {
      setError("회사를 1개 이상 선택하세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: selected, yearCount }),
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
            DART 전자공시시스템 기준으로 최대 {MAX_COMPANIES}개 기업의 최대 {MAX_YEARS}개년
            재무제표를 비교해 엑셀로 다운로드합니다. 업종으로 먼저 좁히고, 회사명으로 다시
            좁혀서 선택하세요.
          </p>
        </div>

        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                1차 필터: 업종
              </label>
              <input
                value={industryQuery}
                onChange={(e) => setIndustryQuery(e.target.value)}
                placeholder="예: 반도체"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                2차 필터: 회사명
              </label>
              <input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="예: 삼성"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                후보 목록 (선택: {selected.length}/{MAX_COMPANIES})
              </span>
              {candidatesLoading && (
                <span className="text-xs text-zinc-400">검색 중...</span>
              )}
            </div>

            {candidatesError && (
              <p className="text-sm text-red-600 dark:text-red-400">{candidatesError}</p>
            )}

            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              {candidates.length === 0 && !candidatesLoading ? (
                <p className="px-3 py-4 text-sm text-zinc-400">
                  검색 결과가 없습니다. 업종 또는 회사명을 입력해보세요.
                </p>
              ) : (
                candidates.map((c) => {
                  const isSelected = selected.includes(c.name);
                  const disabled = !isSelected && selected.length >= MAX_COMPANIES;
                  return (
                    <label
                      key={c.name}
                      className={`flex cursor-pointer items-center justify-between border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-900 ${
                        disabled ? "opacity-40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={disabled}
                          onChange={() => toggleSelect(c.name)}
                        />
                        <span className="text-zinc-800 dark:text-zinc-200">{c.name}</span>
                      </span>
                      <span className="text-xs text-zinc-400">{c.industry}</span>
                    </label>
                  );
                })
              )}
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-white dark:bg-zinc-100 dark:text-black"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleSelect(name)}
                      className="text-zinc-300 hover:text-white dark:text-zinc-600 dark:hover:text-black"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              조회 연도 수 (최대 {MAX_YEARS}, 사업보고서 기준)
            </label>
            <input
              type="number"
              min={1}
              max={MAX_YEARS}
              value={yearCount}
              onChange={(e) =>
                setYearCount(Math.max(1, Math.min(MAX_YEARS, Number(e.target.value))))
              }
              className="w-24 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
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
