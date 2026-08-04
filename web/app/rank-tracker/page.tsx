"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { contentService, type RankCheckResponse, type RankResult } from "@/lib/content-service";

const HANDOFF_KEY = "blog_studio:handoff_rank_tracker";

export default function RankTrackerPage() {
  const [domain, setDomain] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [includeBlog, setIncludeBlog] = useState(true);
  const [includeWeb, setIncludeWeb] = useState(true);

  const mutation = useMutation<RankCheckResponse, Error, void>({
    mutationFn: async () => {
      const types: ("blog" | "web")[] = [];
      if (includeBlog) types.push("blog");
      if (includeWeb) types.push("web");
      const keywords = parseKeywords(keywordsText);
      return contentService.rankCheck({ domain, keywords, types });
    },
  });

  // /keywords 에서 handoff 된 키워드 받기
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { keywords?: string[] };
      if (Array.isArray(data.keywords) && data.keywords.length > 0) {
        setKeywordsText(data.keywords.join("\n"));
      }
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem(HANDOFF_KEY);
  }, []);

  // 결과를 (키워드 → {blog, web}) 로 그룹화 (한 행에 두 타입 같이 표시)
  const grouped = useMemo(() => {
    const data = mutation.data?.results ?? [];
    const map = new Map<string, { blog?: RankResult; web?: RankResult }>();
    for (const r of data) {
      const cur = map.get(r.keyword) ?? {};
      cur[r.search_type] = r;
      map.set(r.keyword, cur);
    }
    // 키워드 입력 순서 유지하면서 결과 매칭
    const keywords = parseKeywords(keywordsText);
    return keywords
      .map((kw) => ({ keyword: kw, ...(map.get(kw) ?? {}) }))
      .filter((x) => x.blog || x.web);
  }, [mutation.data, keywordsText]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) {
      alert("도메인을 입력해주세요.");
      return;
    }
    if (!includeBlog && !includeWeb) {
      alert("블로그 또는 웹 중 하나는 선택해야 합니다.");
      return;
    }
    if (parseKeywords(keywordsText).length === 0) {
      alert("키워드를 최소 1개 입력해주세요.");
      return;
    }
    mutation.mutate();
  }

  const summary = useMemo(() => {
    if (!mutation.data) return null;
    const blogRanked = mutation.data.results.filter((r) => r.search_type === "blog" && r.rank !== null).length;
    const webRanked = mutation.data.results.filter((r) => r.search_type === "web" && r.rank !== null).length;
    const blogTotal = mutation.data.results.filter((r) => r.search_type === "blog").length;
    const webTotal = mutation.data.results.filter((r) => r.search_type === "web").length;
    return { blogRanked, webRanked, blogTotal, webTotal };
  }, [mutation.data]);

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-neutral-700" />
            도메인 순위 추적
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            대상 도메인 + 후보 키워드 → Naver 검색에서 해당 도메인이 몇 위에 노출되는지 확인.
            Top 30 안에 들면 순위 표시.
          </p>
        </header>

        <form onSubmit={onSubmit} className="bg-white border rounded-lg p-4 space-y-4">
          <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
            <label className="block">
              <span className="text-xs text-neutral-600">대상 도메인 (https:// 없이)</span>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="예: savetax.kr, toss.im, blog.naver.com"
                className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </label>
            <div className="flex gap-3 items-center text-sm pb-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={includeBlog} onChange={(e) => setIncludeBlog(e.target.checked)} />
                블로그
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={includeWeb} onChange={(e) => setIncludeWeb(e.target.checked)} />
                웹
              </label>
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-neutral-600">
              키워드 (한 줄에 하나 또는 콤마 구분, 최대 30개)
            </span>
            <textarea
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={"예:\n종합소득세 신고\n절세 방법\n간편장부\n\n또는: 종합소득세 신고, 절세 방법, 간편장부"}
              rows={6}
              className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono"
            />
            <span className="text-[11px] text-neutral-400 mt-1 inline-block">
              현재 {parseKeywords(keywordsText).length}개 입력됨
            </span>
          </label>

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-neutral-400">
              ※ Naver Open API 호출 (Client ID/Secret 필요). 키워드 30개 × 2타입 = 약 60회 호출 → 10~20초 걸림.
            </p>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="bg-neutral-900 text-white text-sm rounded px-5 py-2 font-medium disabled:opacity-50"
            >
              {mutation.isPending ? "조회 중..." : "순위 조회"}
            </button>
          </div>
        </form>

        {mutation.error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        {summary && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="대상 도메인" value={mutation.data!.domain} small />
            <Stat label="조회한 키워드" value={`${grouped.length}개`} />
            <Stat
              label="블로그 노출"
              value={`${summary.blogRanked} / ${summary.blogTotal}`}
              tone={summary.blogRanked > 0 ? "ok" : "default"}
            />
            <Stat
              label="웹 노출"
              value={`${summary.webRanked} / ${summary.webTotal}`}
              tone={summary.webRanked > 0 ? "ok" : "default"}
            />
          </section>
        )}

        {grouped.length > 0 && (
          <section className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b">
                <tr className="text-left text-neutral-600 text-xs">
                  <th className="px-3 py-2">키워드</th>
                  <th className="px-3 py-2 w-24 text-center">블로그</th>
                  <th className="px-3 py-2 w-24 text-center">웹</th>
                  <th className="px-3 py-2">매칭 URL</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((row) => {
                  const matched = row.blog?.matched_url || row.web?.matched_url;
                  const matchedTitle = row.blog?.matched_title || row.web?.matched_title;
                  return (
                    <tr key={row.keyword} className="border-b hover:bg-neutral-50">
                      <td className="px-3 py-2 font-medium">{row.keyword}</td>
                      <td className="px-3 py-2 text-center">
                        <RankBadge result={row.blog} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <RankBadge result={row.web} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {matched ? (
                          <a
                            href={matched}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-neutral-700 hover:text-brand hover:underline truncate block max-w-md"
                            title={matched}
                          >
                            {stripHtml(matchedTitle ?? matched)}
                          </a>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {mutation.data && grouped.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-8">
            결과가 없습니다.
          </p>
        )}

        {mutation.data && (
          <p className="text-xs text-neutral-400">
            DB 스냅샷 {mutation.data.saved_count}건 저장 · 시간이 쌓이면 변동 추적 가능
          </p>
        )}
      </div>
    </main>
  );
}

function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // 줄바꿈과 콤마 둘 다 구분자로
  const tokens = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function RankBadge({ result }: { result?: RankResult }) {
  if (!result) return <span className="text-neutral-300 text-xs">-</span>;
  if (result.error) {
    return (
      <span
        className="text-xs text-red-600"
        title={result.error}
      >
        오류
      </span>
    );
  }
  if (result.rank === null) {
    return <span className="text-neutral-400 text-xs">-</span>;
  }
  const tone =
    result.rank <= 3
      ? "bg-green-100 text-green-800"
      : result.rank <= 10
        ? "bg-amber-100 text-amber-800"
        : "bg-neutral-100 text-neutral-700";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${tone}`}
      title={`전체 결과 ${result.total_results.toLocaleString()}건 중 ${result.rank}위`}
    >
      {result.rank}위
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  small,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok";
  small?: boolean;
}) {
  const cls = tone === "ok" ? "text-green-700" : "text-neutral-900";
  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 ${small ? "text-sm font-mono truncate" : "text-xl font-bold"} ${cls}`}>
        {value}
      </div>
    </div>
  );
}
