"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";

const METHOD_LABELS: Record<number, string> = {
  1: "C랭크 다이아+",
  2: "알콘",
  3: "AEO",
  4: "홈피드",
  5: "인사이트엣지",
  6: "정부지원",
};

interface PostRow {
  id: string;
  method_id: number;
  topic: string;
  main_keyword: string;
  title: string | null;
  body_char_count: number | null;
  axiom_pass_rate: string | null;
  axiom_total: number | null;
  axiom_passed: number | null;
  needs_human_review: boolean;
  llm_provider: string | null;
  created_at: string;
}

export default function PostsListPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState<number | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const { data, error } = await sb
          .from("blog_posts")
          .select(
            "id, method_id, topic, main_keyword, title, body_char_count, axiom_pass_rate, axiom_total, axiom_passed, needs_human_review, llm_provider, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200);
        if (cancelled) return;
        if (error) setError(error.message);
        else setPosts((data as PostRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!posts) return [];
    const q = filter.trim().toLowerCase();
    return posts.filter((p) => {
      if (methodFilter !== "all" && p.method_id !== methodFilter) return false;
      if (q) {
        const hay = `${p.title ?? ""} ${p.topic} ${p.main_keyword}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [posts, filter, methodFilter]);

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">내 글</h1>
            <p className="text-xs text-neutral-500 mt-1">생성한 블로그 글 목록 (최신 200개)</p>
          </div>
          <Link
            href="/generate"
            className="bg-brand text-white text-sm rounded px-4 py-2 hover:bg-brand-600"
          >
            + 새 글 생성
          </Link>
        </header>

        <div className="flex gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="제목 / 주제 / 키워드 검색"
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <select
            value={methodFilter}
            onChange={(e) =>
              setMethodFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="all">방식 전체</option>
            {Object.entries(METHOD_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {id}. {label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="border rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-neutral-50 border-b text-neutral-600 text-left text-xs whitespace-nowrap">
              <tr>
                <th className="px-3 py-2 w-20 text-center">방식</th>
                <th className="px-3 py-2">제목</th>
                <th className="px-3 py-2 w-32">메인 키워드</th>
                <th className="px-3 py-2 w-20 text-right">글자수</th>
                <th className="px-3 py-2 w-28 text-right">공리</th>
                <th className="px-3 py-2 w-20">LLM</th>
                <th className="px-3 py-2 w-28">생성일</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {posts === null && (
                <tr>
                  <td colSpan={8} className="text-center text-neutral-400 py-10">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {posts !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-neutral-400 py-10">
                    {posts.length === 0 ? "아직 생성된 글이 없습니다." : "필터 조건에 맞는 글이 없습니다."}
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const passRate =
                  p.axiom_total && p.axiom_passed !== null
                    ? Math.round((p.axiom_passed / p.axiom_total) * 100)
                    : null;
                return (
                  <tr key={p.id} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2 text-center text-neutral-500 whitespace-nowrap">
                      {METHOD_LABELS[p.method_id] ?? p.method_id}
                    </td>
                    <td className="px-3 py-2 break-keep">
                      <Link
                        href={`/posts/${p.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {p.title || p.topic}
                      </Link>
                      {p.needs_human_review && (
                        <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5 whitespace-nowrap">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          검토 필요
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 truncate whitespace-nowrap">{p.main_keyword}</td>
                    <td className="px-3 py-2 text-right text-neutral-600 whitespace-nowrap">
                      {p.body_char_count?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {passRate !== null ? (
                        <span
                          className={
                            passRate >= 100
                              ? "text-green-700"
                              : passRate >= 80
                                ? "text-amber-600"
                                : "text-red-600"
                          }
                        >
                          {p.axiom_passed}/{p.axiom_total} ({passRate}%)
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{p.llm_provider ?? "-"}</td>
                    <td className="px-3 py-2 text-neutral-500 text-xs whitespace-nowrap">
                      {new Date(p.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link
                        href={`/posts/${p.id}`}
                        className="text-xs text-brand hover:underline inline-flex items-center gap-0.5"
                      >
                        보기 <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {posts && (
          <p className="text-xs text-neutral-400">
            {filtered.length} / {posts.length} 개 표시
          </p>
        )}
      </div>
    </main>
  );
}
