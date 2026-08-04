"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  X,
  Lightbulb,
  Clipboard,
  Wallet,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  contentService,
  type GenerateRequest,
  type GenerateResponse,
  type ResearchContextItem,
  type SearchIntent,
  type JtbdType,
} from "@/lib/content-service";
import { getBrowserSupabase } from "@/lib/supabase";
import { listDomains, type DomainRow } from "@/lib/ontology/domain-loader";
import { recommendStrategy } from "@/lib/ontology/strategy-recommender";

const SEARCH_INTENTS: SearchIntent[] = ["정보탐색", "자격진단", "절차해결", "문제해결", "비교선택"];
const JTBDS: JtbdType[] = ["시간절약", "리스크회피", "의사결정지원", "자기효능감", "위임판단"];
const LAST_DOMAIN_KEY = "blog_studio:last_domain"; // 2B — 마지막 사용 도메인 기억

const RESEARCH_STORAGE_KEY = "blog_studio:research_context";
const LAST_GENERATE_KEY = "blog_studio:last_generate_result"; // 페이지 이동/새로고침 후 복원
const HANDOFF_CARDS_KEY = "blog_studio:handoff_cards"; // → /cards
const HANDOFF_IMAGES_KEY = "blog_studio:handoff_images"; // → /images

const METHODS = [
  { id: 1, label: "C랭크 다이아플러스" },
  { id: 2, label: "알콘" },
  { id: 3, label: "AEO" },
  { id: 4, label: "홈피드" },
  { id: 5, label: "인사이트 엣지" },
  { id: 6, label: "C랭크 정보성 (정부지원)" },
] as const;

const AWARENESS = [
  { v: "L1", desc: "주제 모름 (발견 단계)" },
  { v: "L2", desc: "자격 궁금" },
  { v: "L3", desc: "방법 궁금" },
  { v: "L4", desc: "실패 경험 있음" },
] as const;

const PROVIDERS = ["gemini", "openai", "anthropic"] as const;

// 방식별 domain_info 템플릿 — 핵심 4필드만. 빈 값은 LLM이 "확인 필요"로 처리.
const DOMAIN_INFO_TEMPLATES: Record<number, string> = {
  // 방식 6 (정부지원사업 정보성)
  6: JSON.stringify(
    {
      사업명: "",
      주관기관: "",
      공고링크: "",
      메모: "여기에 자유롭게 핵심 사실을 적으세요 (자격·지원금액·신청기한·필요서류 등)",
    },
    null,
    2,
  ),
};

const DOMAIN_INFO_HINTS: Record<number, string> = {
  6: "공고링크만 넣어도 서버가 자동으로 본문을 가져와 LLM에게 전달합니다. 더 정확하게 하려면 사업명·주관기관·메모를 같이 채우세요.",
};

function GenerateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 페이지 이동/새로고침 후에도 결과 유지하기 위해 localStorage에 영속화
  const [storedResult, setStoredResult] = useState<GenerateResponse | null>(null);
  const [methodId, setMethodId] = useState<number>(6);
  const [topic, setTopic] = useState("");
  const [mainKeyword, setMainKeyword] = useState("");
  const [subKeywords, setSubKeywords] = useState("");
  const [awareness, setAwareness] = useState<"L1" | "L2" | "L3" | "L4">("L2");
  const [persona, setPersona] = useState("30대 경영자/대표");
  const [authorPersona, setAuthorPersona] = useState("");
  const [domainInfo, setDomainInfo] = useState("");
  const [provider, setProvider] =
    useState<(typeof PROVIDERS)[number]>("gemini");

  // Ontology v2 — 도메인·검색의도·JTBD
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [domainCode, setDomainCode] = useState<string>("");
  const [searchIntent, setSearchIntent] = useState<SearchIntent | "">("");
  const [jtbdType, setJtbdType] = useState<JtbdType | "">("");

  const [autoResearch, setAutoResearch] = useState(true);
  const [research, setResearch] = useState<ResearchContextItem[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  // 좌표 (level + intent + jtbd) 가 충분히 채워지면 추천 자동 계산
  const recommendation = useMemo(() => {
    // intent / jtbd 둘 중 하나라도 있어야 의미 있는 추천
    if (!searchIntent && !jtbdType) return null;
    return recommendStrategy({
      level: awareness,
      intent: searchIntent || null,
      jtbd: jtbdType || null,
    });
  }, [awareness, searchIntent, jtbdType]);

  // 도메인 목록 로드 + default 선택 (2A 시스템 default + 2B 마지막 사용)
  useEffect(() => {
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const list = await listDomains(sb);
        setDomains(list);
        if (list.length === 0) return;
        // 2B 우선 — localStorage의 마지막 사용 도메인이 있으면 선택
        const last = typeof window !== "undefined" ? localStorage.getItem(LAST_DOMAIN_KEY) : null;
        if (last && list.some((d) => d.domain_code === last)) {
          setDomainCode(last);
        } else {
          // 2A 폴백 — 첫 도메인
          setDomainCode(list[0].domain_code);
        }
      } catch {
        /* ignore — 도메인 없어도 글 생성은 가능 */
      }
    })();
  }, []);

  // 방식 변경 시: domain_info 템플릿 자동 prefill (빈 상태일 때만, 사용자 입력 보존)
  useEffect(() => {
    if (!domainInfo.trim() && DOMAIN_INFO_TEMPLATES[methodId]) {
      setDomainInfo(DOMAIN_INFO_TEMPLATES[methodId]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodId]);

  // URL 파라미터 + sessionStorage 에서 사전 채움
  useEffect(() => {
    const main = searchParams.get("main");
    const sub = searchParams.get("sub");
    const t = searchParams.get("topic");
    const kw = searchParams.get("keyword"); // 단일 키워드 호환
    if (main) setMainKeyword(main);
    else if (kw) setMainKeyword(kw);
    if (sub) setSubKeywords(sub);
    if (t) setTopic(t);

    // /keywords 에서 "선택해서 보내기" 한 참고 자료
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem(RESEARCH_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as ResearchContextItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setResearch(parsed);
            setAutoResearch(false); // 사용자가 직접 선택했으니 자동 페치는 끔
          }
        } catch {
          /* ignore */
        }
        sessionStorage.removeItem(RESEARCH_STORAGE_KEY);
      }
    }
  }, [searchParams]);

  async function fetchResearchManually() {
    if (!mainKeyword.trim()) {
      alert("메인 키워드를 먼저 입력해주세요.");
      return;
    }
    setResearchLoading(true);
    setResearchError(null);
    try {
      const res = await contentService.research(mainKeyword.trim(), 10, true);
      setResearch(res.items);
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setResearchLoading(false);
    }
  }

  function removeResearchItem(idx: number) {
    setResearch((prev) => prev.filter((_, i) => i !== idx));
  }

  const mutation = useMutation<GenerateResponse, Error, GenerateRequest>({
    mutationFn: (body) => contentService.generate(body),
    onSuccess: (data) => {
      setStoredResult(data);
      try {
        localStorage.setItem(LAST_GENERATE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("결과 localStorage 저장 실패:", e);
      }
    },
  });

  // 마운트 시 localStorage에서 직전 결과 복원
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(LAST_GENERATE_KEY);
      if (raw) setStoredResult(JSON.parse(raw) as GenerateResponse);
    } catch {
      /* ignore */
    }
  }, []);

  function clearStoredResult() {
    setStoredResult(null);
    mutation.reset();
    try {
      localStorage.removeItem(LAST_GENERATE_KEY);
    } catch {
      /* ignore */
    }
  }

  function handoffToCards(result: GenerateResponse) {
    const title =
      (result.titles?.[0] as { title?: string } | undefined)?.title ?? "";
    const payload = {
      title,
      body: result.body,
      keywords: [
        ...(result.meta && Array.isArray((result.meta as { sub_keywords?: string[] }).sub_keywords)
          ? ((result.meta as { sub_keywords?: string[] }).sub_keywords ?? [])
          : []),
      ],
      // 도메인 카드 디자인을 자동 적용하기 위해 domain_code 도 같이 전달
      domain_code: domainCode || undefined,
    };
    try {
      sessionStorage.setItem(HANDOFF_CARDS_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    router.push("/cards");
  }

  function handoffToImages(result: GenerateResponse) {
    const mainKeyword =
      (result.meta as { main_keyword?: string } | undefined)?.main_keyword ?? "";
    try {
      sessionStorage.setItem(HANDOFF_IMAGES_KEY, JSON.stringify({ keyword: mainKeyword }));
    } catch {
      /* ignore */
    }
    router.push("/images");
  }

  // 프롬프트 미리보기 모달 상태
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  function parseDomainInfo(): Record<string, unknown> | undefined {
    if (!domainInfo.trim()) return undefined;
    try {
      const parsed = JSON.parse(domainInfo);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { 메모: String(parsed) };
    } catch {
      return { 메모: domainInfo.trim() };
    }
  }

  async function ensureResearch(): Promise<ResearchContextItem[]> {
    if (!autoResearch || research.length > 0) return research;
    setResearchLoading(true);
    try {
      const res = await contentService.research(mainKeyword.trim(), 10, true);
      setResearch(res.items);
      return res.items;
    } catch (e) {
      setResearchError(`참고 자료 페치 실패: ${e instanceof Error ? e.message : String(e)} (참고 없이 진행)`);
      return research;
    } finally {
      setResearchLoading(false);
    }
  }

  function buildInputPayload(researchToSend: ResearchContextItem[]) {
    return {
      method_id: methodId,
      topic: topic.trim(),
      main_keyword: mainKeyword.trim(),
      sub_keywords: subKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      target_awareness_level: awareness,
      search_intent: searchIntent || undefined,
      jtbd_type: jtbdType || undefined,
      persona,
      author_persona: authorPersona.trim() || undefined,
      domain_info: parseDomainInfo(),
      research_context: researchToSend.length > 0 ? researchToSend : undefined,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const researchToSend = await ensureResearch();

    // 마지막 사용 도메인 기억
    if (domainCode && typeof window !== "undefined") {
      localStorage.setItem(LAST_DOMAIN_KEY, domainCode);
    }

    mutation.mutate({
      provider,
      domain_code: domainCode || null,
      input: buildInputPayload(researchToSend),
    });
  }

  async function onCopyPrompt() {
    if (!mainKeyword.trim() || !topic.trim() || !subKeywords.trim()) {
      alert("주제·메인 키워드·서브 키워드를 먼저 입력해주세요.");
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    setPromptCopied(false);
    try {
      const researchToSend = await ensureResearch();
      const res = await fetch("/api/preview-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_code: domainCode || null,
          input: buildInputPayload(researchToSend),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "프롬프트 빌드 실패");
      }
      setPromptPreview(data.prompt as string);
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : String(e));
    } finally {
      setPromptLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!promptPreview) return;
    try {
      await navigator.clipboard.writeText(promptPreview);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (e) {
      alert(`복사 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 새로 생성한 결과(mutation.data) 우선, 없으면 localStorage 복원본
  const result = mutation.data ?? storedResult;

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold">블로그 글 생성</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Ontology v2 Phase 1 · 6가지 SEO 방식 · Gemini/OpenAI/Anthropic
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="grid gap-4 bg-white border rounded-lg p-6"
        >
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium">방식</span>
              <select
                value={methodId}
                onChange={(e) => setMethodId(Number(e.target.value))}
                className="mt-1 w-full border rounded px-3 py-2"
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}. {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">도메인 (Ontology v2)</span>
              <select
                value={domainCode}
                onChange={(e) => setDomainCode(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
              >
                <option value="">(없음 — v1 호환 모드)</option>
                {domains.map((d) => (
                  <option key={d.domain_code} value={d.domain_code}>
                    {d.domain_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm font-medium">인지단계</span>
              <select
                value={awareness}
                onChange={(e) =>
                  setAwareness(e.target.value as typeof awareness)
                }
                className="mt-1 w-full border rounded px-3 py-2"
              >
                {AWARENESS.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.v} — {a.desc}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">검색의도</span>
              <select
                value={searchIntent}
                onChange={(e) => setSearchIntent(e.target.value as SearchIntent | "")}
                className="mt-1 w-full border rounded px-3 py-2"
              >
                <option value="">(미지정)</option>
                {SEARCH_INTENTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">JTBD</span>
              <select
                value={jtbdType}
                onChange={(e) => setJtbdType(e.target.value as JtbdType | "")}
                className="mt-1 w-full border rounded px-3 py-2"
              >
                <option value="">(미지정)</option>
                {JTBDS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Strategy Recommender 결과 — 좌표가 충분히 채워졌을 때만 */}
          {recommendation && (
            <div
              className={`border rounded-md p-3 text-sm ${
                recommendation.recommended_method_id === methodId
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">
                    {recommendation.recommended_method_id === methodId ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        좌표와 방식이 일치
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Lightbulb className="w-3 h-3" />
                        추천 방식
                      </span>
                    )}
                  </span>
                  <span className="ml-2 text-xs text-neutral-600">{recommendation.reasoning}</span>
                </div>
                {recommendation.recommended_method_id !== methodId && (
                  <button
                    type="button"
                    onClick={() => setMethodId(recommendation.recommended_method_id)}
                    className="text-xs border border-amber-400 text-amber-700 rounded px-2 py-1 hover:bg-white"
                  >
                    방식 {recommendation.recommended_method_id}로 변경
                  </button>
                )}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-neutral-500">전체 점수표</summary>
                <ul className="mt-1 text-xs text-neutral-600 grid grid-cols-2 gap-x-4">
                  {recommendation.scores.map((s) => (
                    <li key={s.method_id} className="flex items-center gap-1">
                      <span className="font-mono w-4">{s.method_id}.</span>
                      <span className="flex-1">{s.label}</span>
                      <span className="font-medium">{s.score}점</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium">글 주제 (topic)</span>
            <input
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="예: 2026 소상공인 혁신성장촉진자금 스마트기술"
              className="mt-1 w-full border rounded px-3 py-2"
            />
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium">메인 키워드</span>
              <input
                required
                value={mainKeyword}
                onChange={(e) => setMainKeyword(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                서브 키워드 (쉼표 구분)
              </span>
              <input
                value={subKeywords}
                onChange={(e) => setSubKeywords(e.target.value)}
                placeholder="키워드1, 키워드2, 키워드3"
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium">독자 페르소나</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                글을 <b>읽는</b> 사람의 직업·상황·고민
              </span>
              <input
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="예: 30대 1인 경영자, 운영자금 부족, 정책 정보 어려움"
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">작성자 페르소나 (선택)</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                글을 <b>쓰는</b> 사람의 경력·말투·톤
              </span>
              <input
                value={authorPersona}
                onChange={(e) => setAuthorPersona(e.target.value)}
                placeholder="예: 정부지원사업 컨설턴트 5년, 친근하지만 전문적, 사례 위주"
                className="mt-1 w-full border rounded px-3 py-2"
              />
            </label>
          </div>

          {/* 참고 자료 (상위 블로그) — 1차: 자동 페치 토글, 2차: /keywords 에서 사전 선택 */}
          <div className="border rounded-md p-3 bg-neutral-50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm flex-wrap">
                <input
                  type="checkbox"
                  checked={autoResearch}
                  onChange={(e) => setAutoResearch(e.target.checked)}
                />
                <span className="font-medium">참고 자료 자동 페치</span>
                <span className="text-neutral-500 text-xs">(생성 직전에 메인 키워드로 상위 블로그 10개 자동 가져옴)</span>
              </label>
              <button
                type="button"
                onClick={fetchResearchManually}
                disabled={researchLoading || !mainKeyword.trim()}
                className="text-xs border rounded px-3 py-1 hover:bg-white disabled:opacity-50"
              >
                {researchLoading ? "페치 중..." : "지금 페치"}
              </button>
            </div>
            {researchError && (
              <p className="text-xs text-amber-700 mt-2">{researchError}</p>
            )}
            {research.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-neutral-600">참고 자료 {research.length}개 (LLM 프롬프트에 포함됨)</p>
                <ul className="space-y-1 text-xs">
                  {research.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 bg-white border rounded px-2 py-1.5">
                      <span className="text-neutral-400 w-5">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{r.title}</div>
                        {r.bloggername && (
                          <div className="text-neutral-500">{r.bloggername} {r.body ? `· 본문 ${r.body.length}자` : "· 본문 없음"}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeResearchItem(i)}
                        className="text-red-500 hover:text-red-700"
                        title="참고 목록에서 제거"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-sm font-medium">
              domain_info (선택, JSON 또는 자유 텍스트)
            </span>
            {DOMAIN_INFO_HINTS[methodId] ? (
              <p className="text-xs text-amber-700 mt-1 inline-flex items-start gap-1">
                <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0" />
                {DOMAIN_INFO_HINTS[methodId]}
              </p>
            ) : (
              <p className="text-xs text-neutral-500 mt-1">
                이 방식은 자유 양식. 글에 반영할 사실 데이터가 있으면 자유롭게 적으세요 (비워도 됨).
              </p>
            )}
            <div className="flex items-start gap-2 mt-1">
              <textarea
                rows={methodId === 6 ? 9 : 4}
                value={domainInfo}
                onChange={(e) => setDomainInfo(e.target.value)}
                placeholder={
                  methodId === 6
                    ? '{"공고링크": "https://www.bizinfo.go.kr/..."}'
                    : "예: 2025년 1월 1일부터 간이과세 기준이 1억으로 상향됨..."
                }
                className="flex-1 border rounded px-3 py-2 font-mono text-xs"
              />
              <div className="flex flex-col gap-1">
                {DOMAIN_INFO_TEMPLATES[methodId] && (
                  <button
                    type="button"
                    onClick={() => setDomainInfo(DOMAIN_INFO_TEMPLATES[methodId])}
                    className="text-xs border rounded px-2 py-1 hover:bg-neutral-50"
                    title="템플릿으로 덮어쓰기"
                  >
                    템플릿
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDomainInfo("")}
                  className="text-xs border rounded px-2 py-1 hover:bg-neutral-50"
                >
                  비우기
                </button>
              </div>
            </div>
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <label className="flex items-center gap-2">
              <span className="text-sm font-medium">LLM</span>
              <select
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as (typeof PROVIDERS)[number])
                }
                className="border rounded px-3 py-2 flex-1 sm:flex-none"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button
                type="button"
                onClick={onCopyPrompt}
                disabled={promptLoading}
                title="LLM 호출 없이 프롬프트만 만들어서 ChatGPT/Claude 웹 UI에 붙여넣기"
                className="border border-neutral-300 text-neutral-700 rounded px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60 whitespace-nowrap inline-flex items-center justify-center gap-1.5"
              >
                {promptLoading ? (
                  "준비 중..."
                ) : (
                  <>
                    <Clipboard className="w-4 h-4" />
                    프롬프트 복사
                  </>
                )}
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="bg-brand text-white rounded px-6 py-2 font-medium disabled:opacity-60 whitespace-nowrap"
              >
                {mutation.isPending ? "생성 중..." : "글 생성"}
              </button>
            </div>
          </div>
        </form>

        {promptError && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {promptError}
          </div>
        )}

        {promptPreview !== null && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4"
            onClick={() => setPromptPreview(null)}
          >
            <div
              className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="px-4 py-3 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">프롬프트 ({promptPreview.length.toLocaleString()}자)</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    이 내용을 복사해서 ChatGPT/Claude/Gemini 웹에 붙여넣으면 API 비용 없이 글을 받을 수 있어요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPromptPreview(null)}
                  className="text-neutral-400 hover:text-neutral-700 text-xl leading-none"
                  aria-label="닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs whitespace-pre-wrap break-words font-mono text-neutral-800">
                  {promptPreview}
                </pre>
              </div>
              <footer className="px-4 py-3 border-t flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPromptPreview(null)}
                  className="text-sm text-neutral-600 hover:text-neutral-900 px-3 py-1.5"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="bg-neutral-900 text-white text-sm rounded px-4 py-1.5 hover:bg-neutral-800"
                >
                  {promptCopied ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      복사됨
                    </span>
                  ) : (
                    "클립보드에 복사"
                  )}
                </button>
              </footer>
            </div>
          </div>
        )}

        {mutation.error && (
          <div className="border border-red-200 bg-red-50 rounded p-4 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        {result && (
          <ResultView
            result={result}
            onClear={clearStoredResult}
            onHandoffCards={() => handoffToCards(result)}
            onHandoffImages={() => handoffToImages(result)}
            isStored={!mutation.data && !!storedResult}
          />
        )}
      </div>
    </main>
  );
}

function ResultView({
  result,
  onClear,
  onHandoffCards,
  onHandoffImages,
  isStored,
}: {
  result: GenerateResponse;
  onClear: () => void;
  onHandoffCards: () => void;
  onHandoffImages: () => void;
  isStored: boolean;
}) {
  const passRate =
    result.axiom_check?.total && result.axiom_check?.passed !== undefined
      ? (result.axiom_check.passed / result.axiom_check.total) * 100
      : null;
  return (
    <div className="space-y-4">
      {/* 다음 단계 액션 — 다른 페이지로 데이터 들고 이동 */}
      <div className="flex flex-wrap items-center gap-2 bg-brand-50 border border-brand/20 rounded-lg p-3">
        <span className="text-sm font-medium text-brand mr-2">다음 단계:</span>
        {result.post_id && (
          <Link
            href={`/posts/${result.post_id}`}
            className="bg-brand text-white text-sm rounded px-3 py-1.5 hover:bg-brand-600 inline-flex items-center gap-1"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            내 글에서 보기/편집
          </Link>
        )}
        <button
          type="button"
          onClick={onHandoffCards}
          className="bg-brand text-white text-sm rounded px-3 py-1.5 hover:bg-brand-600 inline-flex items-center gap-1"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          이 글로 카드뉴스 만들기
        </button>
        <button
          type="button"
          onClick={onHandoffImages}
          className="bg-brand text-white text-sm rounded px-3 py-1.5 hover:bg-brand-600 inline-flex items-center gap-1"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          이미지 검색
        </button>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs text-neutral-500 border border-neutral-300 rounded px-2 py-1 hover:bg-white"
          title="저장된 결과 비우기"
        >
          결과 비우기
        </button>
      </div>

      {isStored && (
        <p className="text-xs text-neutral-500 -mt-2">
          ※ 직전 세션에서 생성된 결과를 복원했습니다 (페이지 이동 후에도 유지됨).
        </p>
      )}

      {result.cost && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-amber-900 inline-flex items-center gap-1.5">
              <Wallet className="w-4 h-4" />
              이번 생성 비용
            </span>
            <span className="text-amber-800">
              입력 <strong>{result.cost.input_tokens.toLocaleString()}</strong> 토큰 / 출력{" "}
              <strong>{result.cost.output_tokens.toLocaleString()}</strong> 토큰
            </span>
            {result.cost.pricing_known ? (
              <span className="text-amber-900 font-medium">
                = {result.cost.cost_usd !== null
                  ? `$${result.cost.cost_usd.toFixed(4)}`
                  : "?"}
                {result.cost.cost_krw !== null && (
                  <span className="ml-1 text-amber-700">
                    (약 ₩{result.cost.cost_krw.toLocaleString("ko-KR")})
                  </span>
                )}
              </span>
            ) : (
              <span className="text-amber-700 text-xs inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                단가표에 없는 모델 — 비용 미산정 ({result.model})
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-600">
        <span>
          {result.provider} · {result.model}
        </span>
        <span>{(result.duration_ms / 1000).toFixed(1)}초</span>
        {result.axiom_check?.pass_rate && (
          <span
            className={
              passRate !== null && passRate >= 100
                ? "font-medium text-green-700"
                : passRate !== null && passRate >= 80
                  ? "font-medium text-amber-600"
                  : "font-medium text-red-600"
            }
          >
            공리 {result.axiom_check.pass_rate}
            {passRate !== null && ` (${passRate.toFixed(0)}%)`}
          </span>
        )}
        <span>
          시도 {result.final_attempt}/{result.attempts.length}
        </span>
        {result.needs_human_review && (
          <span className="text-red-600 font-medium inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            수동 검토 필요
          </span>
        )}
        {result.post_id && (
          <span className="text-neutral-400 text-xs">
            post_id: {result.post_id.slice(0, 8)}
          </span>
        )}
        {!result.parse_ok && (
          <span className="text-amber-600">
            일부 파싱 이슈: {result.parse_errors.join(", ")}
          </span>
        )}
      </div>

      {result.attempts.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-500">
            시도별 통과율 ({result.attempts.length}회)
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {result.attempts.map((a) => (
              <li key={a.attempt}>
                #{a.attempt}: {a.axiom_passed}/{a.axiom_total} 통과 ·{" "}
                {(a.duration_ms / 1000).toFixed(1)}초
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.titles.length > 0 && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-2">추천 제목</h2>
          <ul className="space-y-2">
            {result.titles.map((t) => (
              <li key={t.rank} className="text-sm">
                <span className="inline-block w-6 text-neutral-400">
                  {t.rank}.
                </span>
                <span className="font-medium">{t.title}</span>
                <span className="ml-2 text-neutral-500">
                  ({"★".repeat(t.ctr_stars)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">
          본문 ({result.body.length.toLocaleString()}자)
        </h2>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {result.body}
        </pre>
      </section>

      {result.axiom_check?.items && result.axiom_check.items.length > 0 && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-2">공리 검증</h2>
          <ul className="space-y-1 text-sm">
            {result.axiom_check.items.map((a) => (
              <li key={a.number} className="flex gap-2">
                <span className={a.passed ? "text-green-600" : "text-red-600"}>
                  {a.passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </span>
                <span className="font-medium w-6">{a.number}</span>
                <span>{a.rule}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// useSearchParams()는 prerender를 중단시키므로 Suspense 경계가 필요하다.
export default function GeneratePage() {
  return (
    <Suspense
      fallback={<p className="p-6 text-sm text-neutral-500">불러오는 중...</p>}
    >
      <GenerateForm />
    </Suspense>
  );
}
