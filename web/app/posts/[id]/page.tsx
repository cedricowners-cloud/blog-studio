"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, AlertTriangle, Clipboard } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";

const HANDOFF_CARDS_KEY = "blog_studio:handoff_cards";
const HANDOFF_IMAGES_KEY = "blog_studio:handoff_images";

interface PostDetail {
  id: string;
  user_id: string;
  method_id: number;
  topic: string;
  main_keyword: string;
  sub_keywords: string[];
  target_awareness_level: string | null;
  persona: string | null;
  title: string | null;
  body: string | null;
  body_char_count: number | null;
  content_type: string | null;
  axiom_total: number | null;
  axiom_passed: number | null;
  axiom_failed: number | null;
  axiom_pass_rate: string | null;
  axiom_failed_list: unknown;
  final_attempt: number | null;
  needs_human_review: boolean;
  llm_provider: string | null;
  generation_duration_ms: number | null;
  meta: Record<string, unknown> | null;
  domain_id: string | null;
  search_intent: string | null;
  jtbd_type: string | null;
  positioning_attribute: string | null;
  created_at: string;
  updated_at: string;
}

const METHOD_LABELS: Record<number, string> = {
  1: "C랭크 다이아플러스",
  2: "알콘",
  3: "AEO",
  4: "홈피드",
  5: "인사이트 엣지",
  6: "C랭크 정보성 (정부지원)",
};

export default function PostDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [post, setPost] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 편집 가능 필드
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sb = getBrowserSupabase();
        const { data, error } = await sb
          .from("blog_posts")
          .select("*")
          .eq("id", id)
          .single();
        if (cancelled) return;
        if (error) {
          setError(error.message);
        } else {
          const p = data as PostDetail;
          setPost(p);
          setEditTitle(p.title ?? "");
          setEditBody(p.body ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function markDirty() {
    setDirty(true);
    setSaveMsg(null);
  }

  async function save() {
    if (!post) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const sb = getBrowserSupabase();
      const { error } = await sb
        .from("blog_posts")
        .update({
          title: editTitle,
          body: editBody,
          body_char_count: editBody.length,
        })
        .eq("id", post.id);
      if (error) {
        setSaveMsg(`저장 실패: ${error.message}`);
      } else {
        setPost({ ...post, title: editTitle, body: editBody, body_char_count: editBody.length });
        setDirty(false);
        setSaveMsg("저장됨");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!post) return;
    if (!confirm(`이 글을 정말 삭제하시겠어요?\n\n"${post.title || post.topic}"\n\n복구 불가능합니다.`)) return;
    try {
      const sb = getBrowserSupabase();
      const { error } = await sb.from("blog_posts").delete().eq("id", post.id);
      if (error) {
        alert(`삭제 실패: ${error.message}`);
        return;
      }
      router.push("/posts");
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handoffToCards() {
    if (!post) return;
    let domainCode: string | undefined;
    if (post.domain_id) {
      try {
        const sb = getBrowserSupabase();
        const { data } = await sb
          .from("domains")
          .select("domain_code")
          .eq("id", post.domain_id)
          .single();
        domainCode = (data as { domain_code?: string } | null)?.domain_code;
      } catch {
        /* ignore */
      }
    }
    const payload = {
      title: editTitle,
      body: editBody,
      keywords: post.sub_keywords ?? [],
      domain_code: domainCode,
    };
    sessionStorage.setItem(HANDOFF_CARDS_KEY, JSON.stringify(payload));
    router.push("/cards");
  }

  function handoffToImages() {
    if (!post) return;
    sessionStorage.setItem(HANDOFF_IMAGES_KEY, JSON.stringify({ keyword: post.main_keyword }));
    router.push("/images");
  }

  function handoffToRegenerate() {
    if (!post) return;
    // 같은 입력으로 /generate에 보내기 — URL 파라미터로
    const params = new URLSearchParams();
    params.set("main", post.main_keyword);
    params.set("topic", post.topic);
    if (post.sub_keywords?.length) params.set("sub", post.sub_keywords.join(","));
    router.push(`/generate?${params.toString()}`);
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(editBody);
      setSaveMsg("본문이 클립보드에 복사됐습니다.");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg("클립보드 복사 실패");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-4xl mx-auto text-center text-neutral-400 py-20">불러오는 중...</div>
      </main>
    );
  }

  if (error || !post) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          <Link href="/posts" className="text-sm text-brand hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            내 글 목록
          </Link>
          <div className="border border-red-200 bg-red-50 rounded p-4 text-sm text-red-700">
            글을 불러올 수 없습니다: {error ?? "찾을 수 없음"}
          </div>
        </div>
      </main>
    );
  }

  const passRate =
    post.axiom_total && post.axiom_passed !== null
      ? Math.round((post.axiom_passed / post.axiom_total) * 100)
      : null;
  const editTitleLength = editTitle.length;
  const editBodyLength = editBody.length;

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/posts" className="text-sm text-brand hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            내 글 목록
          </Link>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>생성: {new Date(post.created_at).toLocaleString("ko-KR")}</span>
            {post.updated_at !== post.created_at && (
              <span>· 수정: {new Date(post.updated_at).toLocaleString("ko-KR")}</span>
            )}
          </div>
        </div>

        {/* 메타 정보 */}
        <section className="bg-white border rounded-lg p-4 text-sm">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-neutral-700">
            <div>
              <span className="text-neutral-400 mr-1">방식:</span>
              {post.method_id}. {METHOD_LABELS[post.method_id] ?? "?"}
            </div>
            <div>
              <span className="text-neutral-400 mr-1">메인 키워드:</span>
              {post.main_keyword}
            </div>
            <div>
              <span className="text-neutral-400 mr-1">인지단계:</span>
              {post.target_awareness_level ?? "-"}
            </div>
            <div>
              <span className="text-neutral-400 mr-1">LLM:</span>
              {post.llm_provider ?? "-"}
            </div>
            {post.sub_keywords?.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-4">
                <span className="text-neutral-400 mr-1">서브 키워드:</span>
                {post.sub_keywords.join(", ")}
              </div>
            )}
            {passRate !== null && (
              <div className="sm:col-span-2 lg:col-span-4">
                <span className="text-neutral-400 mr-1">공리:</span>
                <span
                  className={
                    passRate >= 100
                      ? "text-green-700 font-medium"
                      : passRate >= 80
                        ? "text-amber-600 font-medium"
                        : "text-red-600 font-medium"
                  }
                >
                  {post.axiom_passed}/{post.axiom_total} ({passRate}%)
                </span>
                {post.needs_human_review && (
                  <span className="ml-2 text-amber-700 text-xs inline-flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" />
                    수동 검토 필요
                  </span>
                )}
                {post.final_attempt !== null && (
                  <span className="ml-2 text-neutral-400 text-xs">시도 {post.final_attempt}회</span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 액션 바 */}
        <section className="bg-brand-50 border border-brand/20 rounded-lg p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand mr-1">활용:</span>
          <button
            onClick={handoffToCards}
            className="bg-brand text-white text-sm rounded px-3 py-1.5 hover:bg-brand-600 inline-flex items-center gap-1"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            카드뉴스 만들기
          </button>
          <button
            onClick={handoffToImages}
            className="bg-brand text-white text-sm rounded px-3 py-1.5 hover:bg-brand-600 inline-flex items-center gap-1"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            이미지 검색
          </button>
          <button
            onClick={handoffToRegenerate}
            className="border border-brand text-brand text-sm rounded px-3 py-1.5 hover:bg-white"
          >
            ↻ 같은 입력으로 다시 생성
          </button>
          <button
            onClick={copyBody}
            className="border text-sm rounded px-3 py-1.5 hover:bg-white"
          >
            <span className="inline-flex items-center gap-1.5"><Clipboard className="w-3.5 h-3.5" />본문 복사</span>
          </button>
          <button
            onClick={handleDelete}
            className="ml-auto text-sm border border-red-300 text-red-600 rounded px-3 py-1.5 hover:bg-red-50"
          >
            🗑 삭제
          </button>
        </section>

        {/* 편집 영역 */}
        <section className="bg-white border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">제목 / 본문 편집</h2>
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span
                  className={
                    saveMsg.startsWith("저장 실패") || saveMsg.includes("실패")
                      ? "text-xs text-red-600"
                      : "text-xs text-green-700"
                  }
                >
                  {saveMsg}
                </span>
              )}
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="bg-brand text-white text-sm rounded px-4 py-1.5 disabled:opacity-40"
              >
                {saving ? "저장 중..." : dirty ? "저장" : "변경 없음"}
              </button>
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-neutral-500">제목 ({editTitleLength}자)</span>
            <input
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value);
                markDirty();
              }}
              className="mt-1 w-full border rounded px-3 py-2"
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-500">본문 ({editBodyLength}자)</span>
            <textarea
              value={editBody}
              onChange={(e) => {
                setEditBody(e.target.value);
                markDirty();
              }}
              rows={20}
              className="mt-1 w-full border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
        </section>

        {/* 디버그 / 추가 메타 */}
        <details className="bg-white border rounded-lg p-3 text-xs text-neutral-600">
          <summary className="cursor-pointer font-medium">전체 메타 (JSON)</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px]">
            {JSON.stringify(
              {
                topic: post.topic,
                content_type: post.content_type,
                axiom_failed_list: post.axiom_failed_list,
                generation_duration_ms: post.generation_duration_ms,
                meta: post.meta,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </main>
  );
}
