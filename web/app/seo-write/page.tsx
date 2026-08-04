"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PenLine, ArrowRight } from "lucide-react";

const HANDOFF_KEY = "blog_studio:handoff_seo_write";

interface RunSummary {
  id: string;
  main_keyword: string;
  platform: "naver_blog" | "custom_domain";
  mode: "api" | "copy";
  current_step_index: number;
  status: "in_progress" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
}

const PROVIDERS = ["gemini", "openai", "anthropic"] as const;

export default function SeoWriteStartPage() {
  const router = useRouter();
  const [mainKeyword, setMainKeyword] = useState("");
  const [platform, setPlatform] = useState<"naver_blog" | "custom_domain">("naver_blog");
  const [mode, setMode] = useState<"api" | "copy">("copy");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("gemini");
  const [includeOptional, setIncludeOptional] = useState(true);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /keywords handoff
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw) as { main_keyword?: string };
        if (data.main_keyword) setMainKeyword(data.main_keyword);
      } catch {
        /* ignore */
      }
      sessionStorage.removeItem(HANDOFF_KEY);
    }
  }, []);

  // 진행 중 워크플로 목록
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/seo-write/runs");
        const data = await res.json();
        if (res.ok) setRuns(data.runs ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (!mainKeyword.trim()) {
      setError("메인 키워드를 입력해주세요.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/seo-write/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          mode,
          main_keyword: mainKeyword.trim(),
          llm_provider: mode === "api" ? provider : undefined,
          include_optional: includeOptional,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "워크플로 시작 실패");
      router.push(`/seo-write/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const inProgress = runs.filter((r) => r.status === "in_progress");

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            <PenLine className="w-6 h-6 text-neutral-700" />
            SEO 강의 단계별 글쓰기
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            8개 프롬프트를 순차적으로 실행 → 검색의도·개요·본문·다듬기·AEO·타이틀까지 완성
          </p>
        </header>

        <form onSubmit={onStart} className="bg-white border rounded-lg p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-neutral-700">메인 키워드</span>
            <input
              value={mainKeyword}
              onChange={(e) => setMainKeyword(e.target.value)}
              placeholder="예: 종합소득세 신고"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
            <span className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-1.5">
              검색량·경쟁도를 확인하지 않은 키워드는 SEO 효과가 떨어질 수 있어요.
              <Link href="/keywords" className="text-brand hover:underline">
                키워드 분석 페이지로 →
              </Link>
            </span>
          </label>

          <fieldset className="border rounded p-3 space-y-2">
            <legend className="text-xs font-medium text-neutral-700 px-1">
              플랫폼
            </legend>
            {(["naver_blog", "custom_domain"] as const).map((p) => (
              <label key={p} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="platform"
                  value={p}
                  checked={platform === p}
                  onChange={() => setPlatform(p)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium">
                    {p === "naver_blog" ? "네이버 블로그" : "자체 도메인 / 워드프레스 / 티스토리"}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p === "naver_blog"
                      ? "1~6단계만 진행 (URL 슬러그 불필요)"
                      : "1~7단계 진행 (URL 슬러그까지 포함)"}
                  </div>
                </div>
              </label>
            ))}
          </fieldset>

          <fieldset className="border rounded p-3 space-y-2">
            <legend className="text-xs font-medium text-neutral-700 px-1">
              모드
            </legend>
            {(["api", "copy"] as const).map((m) => (
              <label key={m} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium">
                    {m === "api"
                      ? "API 자동 진행"
                      : "프롬프트 복사 수동 진행"}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {m === "api"
                      ? "웹에서 LLM과 대화하며 자동 생성 (API 비용 발생)"
                      : "프롬프트를 복사해서 ChatGPT/Claude 웹에 붙여넣기 (구독료 외 추가 비용 없음)"}
                  </div>
                </div>
              </label>
            ))}
          </fieldset>

          {mode === "api" && (
            <label className="block">
              <span className="text-xs font-medium text-neutral-700">LLM Provider</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-neutral-400 mt-0.5 block">
                모델은 /settings 에서 지정한 기본 모델 사용. API 키도 /settings 에서 관리.
              </span>
            </label>
          )}

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={includeOptional}
              onChange={(e) => setIncludeOptional(e.target.checked)}
            />
            <span>롱테일 키워드 50개 단계도 포함 (보너스)</span>
          </label>

          {error && (
            <div className="border border-red-200 bg-red-50 rounded p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating || !mainKeyword.trim()}
              className="bg-neutral-900 text-white text-sm rounded px-5 py-2 font-medium disabled:opacity-50"
            >
              {creating ? "시작 중..." : "워크플로 시작"}
            </button>
          </div>
        </form>

        {inProgress.length > 0 && (
          <section className="bg-white border rounded-lg p-4 space-y-2">
            <h2 className="font-semibold text-sm">진행 중인 워크플로</h2>
            <ul className="divide-y">
              {inProgress.map((r) => (
                <li key={r.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.main_keyword}</div>
                    <div className="text-xs text-neutral-500">
                      {r.platform === "naver_blog" ? "네이버 블로그" : "자체 도메인"} · {r.mode === "api" ? "API" : "복사"} 모드 ·
                      현재 {r.current_step_index + 1}단계 ·{" "}
                      {new Date(r.updated_at).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                  <Link
                    href={`/seo-write/${r.id}`}
                    className="text-xs border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 inline-flex items-center gap-1"
                  >
                    이어가기 <ArrowRight className="w-3 h-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
