"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  contentService,
  type KeywordLookupResponse,
  type KeywordMetric,
  type KeywordIntent,
  type ResearchContextItem,
  type ResearchResponse,
  type TrendResponse,
} from "@/lib/content-service";
import {
  PenLine,
  BarChart3,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Star,
  Sparkles,
  TrendingUp,
  ChevronUp,
  ChevronDown,
  Download,
} from "lucide-react";
import { INTENT_LABELS, INTENT_COLORS } from "@/lib/keyword-classify";
import { LineChart } from "@/components/sparkline";
import { Tooltip } from "@/components/tooltip";

const RESEARCH_STORAGE_KEY = "blog_studio:research_context";

const INTENT_TABS: Array<{ value: KeywordIntent | "all"; label: string }> = [
  { value: "all", label: "전체" },
  { value: "question", label: "질문형" },
  { value: "comparison", label: "비교형" },
  { value: "transactional", label: "거래형" },
  { value: "informational", label: "정보형" },
];

type SortKey =
  | "keyword"
  | "total_qc"
  | "monthly_pc_qc"
  | "monthly_mobile_qc"
  | "blog_monthly_count"
  | "blog_saturation"
  | "shopping_category"
  | "monthly_ave_pc_clk"
  | "monthly_ave_mobile_clk"
  | "monthly_ave_pc_ctr"
  | "monthly_ave_mobile_ctr"
  | "comp_idx"
  | "pl_avg_depth";

// 경쟁정도 텍스트 → 정렬용 가중치
const COMP_IDX_ORDER: Record<string, number> = {
  "낮음": 1,
  "중간": 2,
  "높음": 3,
};

const TEXT_KEYS: SortKey[] = ["keyword", "shopping_category"];
const ENUM_KEYS: SortKey[] = ["comp_idx"];

// SEO 추천 임계값 — Google Volume 100 ≈ Naver total_qc 200~300 (한국 시장 점유율 환산).
// 보수적으로 300, 사용자가 슬라이더로 조정 가능.
const RECOMMEND_DEFAULT_VOLUME = 300;
const RECOMMEND_MAX_SATURATION = 100; // 포화도 100% 이하 = 발행 글 수가 월간 검색량 이하 → 진입 가능

/**
 * SEO 관점 추천 키워드 판정.
 * - total_qc 가 임계값 이상
 * - 포화도가 100% 이하 (또는 데이터 없음 — null 은 통과시킴)
 */
function isRecommended(row: KeywordMetric, volumeThreshold: number): boolean {
  if (row.total_qc < volumeThreshold) return false;
  if (row.blog_saturation !== null && row.blog_saturation > RECOMMEND_MAX_SATURATION) return false;
  return true;
}

export default function KeywordsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mainKeyword, setMainKeyword] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total_qc");
  const [sortDesc, setSortDesc] = useState(true);
  const [intentFilter, setIntentFilter] = useState<KeywordIntent | "all">("all");
  const [recommendVolume, setRecommendVolume] = useState<number>(RECOMMEND_DEFAULT_VOLUME);
  const [onlyRecommended, setOnlyRecommended] = useState<boolean>(false);

  // 트렌드 모달
  const [trendKeyword, setTrendKeyword] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendResponse | "loading" | { error: string } | null>(null);

  async function openTrend(keyword: string) {
    setTrendKeyword(keyword);
    setTrend("loading");
    try {
      const data = await contentService.keywordTrend(keyword, 12);
      setTrend(data);
    } catch (e) {
      setTrend({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  const mutation = useMutation<KeywordLookupResponse, Error, string>({
    mutationFn: (keyword) => contentService.keywords(keyword),
    onSuccess: () => {
      setSelected(new Set());
      setMainKeyword(null);
      setExpandedRow(null);
      setResearchByKeyword({});
      setResearchSelected(new Set());
    },
  });

  // 행별 "상위 블로그 보기" 상태
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [researchByKeyword, setResearchByKeyword] = useState<Record<string, ResearchResponse | "loading" | { error: string }>>({});
  const [researchSelected, setResearchSelected] = useState<Set<string>>(new Set()); // link 단위 선택

  async function toggleResearch(keyword: string) {
    if (expandedRow === keyword) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(keyword);
    if (researchByKeyword[keyword] && researchByKeyword[keyword] !== "loading") return; // 이미 로드됨
    setResearchByKeyword((prev) => ({ ...prev, [keyword]: "loading" }));
    try {
      const res = await contentService.research(keyword, 10, true);
      setResearchByKeyword((prev) => ({ ...prev, [keyword]: res }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResearchByKeyword((prev) => ({ ...prev, [keyword]: { error: msg } }));
    }
  }

  function toggleResearchSelect(link: string) {
    setResearchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  const rows = useMemo(() => {
    const all = mutation.data?.results ?? [];
    let data = intentFilter === "all" ? all : all.filter((r) => r.intent === intentFilter);
    if (onlyRecommended) data = data.filter((r) => isRecommended(r, recommendVolume));
    const dir = sortDesc ? -1 : 1;
    const sorted = [...data].sort((a, b) => {
      // 텍스트 컬럼: 한국어 사전순
      if (TEXT_KEYS.includes(sortKey)) {
        const sa = (a[sortKey] as string | null) ?? "";
        const sb = (b[sortKey] as string | null) ?? "";
        return sa.localeCompare(sb, "ko") * dir;
      }
      // enum 컬럼: 정해진 가중치 순
      if (ENUM_KEYS.includes(sortKey)) {
        const wa = COMP_IDX_ORDER[(a[sortKey] as string) ?? ""] ?? 0;
        const wb = COMP_IDX_ORDER[(b[sortKey] as string) ?? ""] ?? 0;
        return (wa - wb) * dir;
      }
      // 숫자 컬럼: null은 항상 맨 뒤
      const va = a[sortKey] as number | null | undefined;
      const vb = b[sortKey] as number | null | undefined;
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      return (va - vb) * dir;
    });
    return sorted;
  }, [mutation.data, sortKey, sortDesc, intentFilter, onlyRecommended, recommendVolume]);

  // 추천 키워드 카운트 (전체 결과 대비)
  const recommendedCount = useMemo(() => {
    const all = mutation.data?.results ?? [];
    return all.filter((r) => isRecommended(r, recommendVolume)).length;
  }, [mutation.data, recommendVolume]);

  // 카테고리별 카운트 (탭에 표시)
  const intentCounts = useMemo(() => {
    const all = mutation.data?.results ?? [];
    const counts: Record<KeywordIntent | "all", number> = {
      all: all.length,
      question: 0,
      comparison: 0,
      transactional: 0,
      informational: 0,
    };
    for (const r of all) counts[r.intent]++;
    return counts;
  }, [mutation.data]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  function toggleSelect(kw: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(kw) ? next.delete(kw) : next.add(kw);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.keyword)));
  }

  function downloadCsv() {
    if (selected.size === 0) {
      alert("먼저 키워드를 선택해주세요.");
      return;
    }
    const header = [
      "NO",
      "키워드",
      "월간검색수 PC",
      "월간검색수 Mobile",
      "합계",
      "월간 블로그 발행",
      "포화도(%)",
      "쇼핑 카테고리",
      "월평균 클릭수 PC",
      "월평균 클릭수 Mobile",
      "월평균 클릭율 PC",
      "월평균 클릭율 Mobile",
      "경쟁정도",
      "월평균 노출광고수",
    ];
    const lines = [header.join(",")];
    let no = 1;
    for (const r of rows) {
      if (!selected.has(r.keyword)) continue;
      lines.push(
        [
          no++,
          esc(r.keyword),
          r.monthly_pc_qc,
          r.monthly_mobile_qc,
          r.total_qc,
          r.blog_monthly_count ?? "-",
          r.blog_saturation ?? "-",
          esc(r.shopping_category ?? "-"),
          r.monthly_ave_pc_clk ?? "-",
          r.monthly_ave_mobile_clk ?? "-",
          r.monthly_ave_pc_ctr ?? "-",
          r.monthly_ave_mobile_ctr ?? "-",
          esc(r.comp_idx ?? "-"),
          r.pl_avg_depth ?? "-",
        ].join(","),
      );
    }
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords_${(mutation.data?.query || "export").replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setSelected(new Set());
    setMainKeyword(null);
    mutation.reset();
    setQ("");
  }

  function sendToSeoWrite() {
    if (!mainKeyword) {
      alert("메인 키워드를 라디오로 선택해주세요.");
      return;
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "blog_studio:handoff_seo_write",
        JSON.stringify({ main_keyword: mainKeyword }),
      );
    }
    router.push("/seo-write");
  }

  function sendToRankTracker() {
    if (selected.size === 0) {
      alert("키워드를 먼저 선택해주세요 (체크박스).");
      return;
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "blog_studio:handoff_rank_tracker",
        JSON.stringify({ keywords: Array.from(selected) }),
      );
    }
    router.push("/rank-tracker");
  }

  function sendToGenerate() {
    if (!mainKeyword) {
      alert("메인 키워드를 먼저 선택해주세요 (행 좌측 라디오 버튼).");
      return;
    }
    // 서브 = 선택된 행에서 메인 제외
    const sub = Array.from(selected).filter((k) => k !== mainKeyword);

    // 선택된 참고 자료(블로그) 모으기
    const refItems: ResearchContextItem[] = [];
    for (const v of Object.values(researchByKeyword)) {
      if (v === "loading" || "error" in (v as object)) continue;
      const res = v as ResearchResponse;
      for (const item of res.items) {
        if (researchSelected.has(item.link)) {
          refItems.push({
            title: item.title,
            description: item.description,
            body: item.body,
            link: item.link,
            bloggername: item.bloggername,
          });
        }
      }
    }

    if (refItems.length > 0 && typeof window !== "undefined") {
      sessionStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(refItems));
    }

    const params = new URLSearchParams();
    params.set("main", mainKeyword);
    if (sub.length > 0) params.set("sub", sub.join(","));
    if (q.trim()) params.set("topic", q.trim());
    router.push(`/generate?${params.toString()}`);
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 lg:gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold">키워드 조회 결과</h1>
            <p className="text-xs text-neutral-500 mt-1">
              여러 키워드는 <span className="font-mono bg-neutral-100 px-1 rounded">,</span>{" "}
              로 구분해서 한 번에 조회 (최대 10개) · 검색광고 + 자동완성 + 의도 분류 + 12개월 트렌드
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={sendToSeoWrite}
              disabled={!mainKeyword}
              className="border border-neutral-300 text-neutral-700 rounded px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-neutral-50 inline-flex items-center gap-1.5"
              title="메인 키워드로 SEO 강의 단계별 글쓰기 시작"
            >
              <PenLine className="w-4 h-4" />
              SEO 글쓰기
            </button>
            <button
              onClick={sendToRankTracker}
              disabled={selected.size === 0}
              className="border border-neutral-300 text-neutral-700 rounded px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-neutral-50 inline-flex items-center gap-1.5"
              title="선택한 키워드들로 도메인 순위 추적"
            >
              <BarChart3 className="w-4 h-4" />
              순위 추적 ({selected.size})
            </button>
            <button
              onClick={sendToGenerate}
              disabled={!mainKeyword}
              className="bg-brand text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
              title={mainKeyword ? `메인: ${mainKeyword} / 서브: ${selected.size}개 / 참고 자료: ${researchSelected.size}개` : "메인 키워드를 라디오로 선택"}
            >
              <ArrowRight className="w-4 h-4" />
              글 생성{mainKeyword ? ` (M1+S${Array.from(selected).filter((k) => k !== mainKeyword).length}${researchSelected.size > 0 ? `+R${researchSelected.size}` : ""})` : ""}
            </button>
            <button
              onClick={downloadCsv}
              disabled={selected.size === 0}
              className="border rounded px-4 py-2 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              다운로드 ({selected.size})
            </button>
            <button
              onClick={reset}
              className="border rounded px-4 py-2 text-sm"
            >
              초기화
            </button>
          </div>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) mutation.mutate(q.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="키워드 (예: 종합소득세  또는  세무, 절세, 종합소득세)"
            className="flex-1 border rounded px-3 py-2"
          />
          <button
            type="submit"
            disabled={mutation.isPending || !q.trim()}
            className="bg-neutral-900 text-white rounded px-6 py-2 text-sm font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "조회 중..." : "조회"}
          </button>
        </form>

        {mutation.error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {mutation.error.message}
          </div>
        )}

        {mutation.data && mutation.data.queried_keywords.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-neutral-500 mr-1">조회 키워드:</span>
            {mutation.data.queried_keywords.map((kw) => (
              <span
                key={kw}
                className="inline-block bg-brand-50 text-brand border border-brand/20 rounded px-2 py-0.5 font-medium"
              >
                {kw}
              </span>
            ))}
          </div>
        )}

        {mutation.data && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-amber-900 font-medium inline-flex items-center gap-1.5">
                <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                SEO 추천 키워드
              </span>
              <span className="text-amber-700 text-xs">
                ({recommendedCount}개 / {mutation.data.results.length}개)
              </span>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-amber-800 text-xs">최소 검색량:</span>
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={recommendVolume}
                onChange={(e) => setRecommendVolume(parseInt(e.target.value, 10))}
                className="w-32 accent-amber-600"
              />
              <input
                type="number"
                min={0}
                value={recommendVolume}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v) && v >= 0) setRecommendVolume(v);
                }}
                className="w-20 border border-amber-300 rounded px-2 py-0.5 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={onlyRecommended}
                onChange={(e) => setOnlyRecommended(e.target.checked)}
                className="accent-amber-600"
              />
              <span className="text-xs text-amber-900">추천만 보기</span>
            </label>
            <span className="text-[11px] text-amber-700 w-full">
              ※ 기준: total_qc ≥ {recommendVolume} AND 포화도 ≤ {RECOMMEND_MAX_SATURATION}% ·
              Google Vol 100 ≈ Naver 200~300 (한국 시장 기준)
            </span>
          </div>
        )}

        {mutation.data && (
          <div className="flex flex-wrap items-center gap-2">
            {INTENT_TABS.map((t) => {
              const count = intentCounts[t.value];
              const active = intentFilter === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setIntentFilter(t.value)}
                  className={`text-xs rounded-full px-3 py-1 border transition ${
                    active
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  {t.label} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
            {mutation.data.autocomplete_added > 0 && (
              <span className="ml-2 text-[11px] text-neutral-500 inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                자동완성에서 {mutation.data.autocomplete_added}개 추가됨
              </span>
            )}
          </div>
        )}

        <div className="border rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-neutral-50 border-b">
              <tr className="text-neutral-600">
                <Th rowSpan={2} className="w-10 text-center" title="서브 키워드로 선택 (다운로드/글 생성용)">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                  />
                </Th>
                <Th rowSpan={2} className="w-12 text-center" title="이 행을 메인 키워드로 지정">메인</Th>
                <Th rowSpan={2} className="w-12 text-center">NO</Th>
                <Th rowSpan={2} className="min-w-[200px] max-w-[280px]" onClick={() => toggleSort("keyword")} sortActive={sortKey === "keyword"} sortDesc={sortDesc}>
                  키워드
                </Th>
                <Th colSpan={2} className="text-center">월간검색수</Th>
                <Th rowSpan={2} onClick={() => toggleSort("total_qc")} sortActive={sortKey === "total_qc"} sortDesc={sortDesc}>
                  합계
                </Th>
                <Th rowSpan={2} className="text-right" onClick={() => toggleSort("blog_monthly_count")} sortActive={sortKey === "blog_monthly_count"} sortDesc={sortDesc}>
                  월간 블로그
                  <br />
                  발행 수
                </Th>
                <Th
                  rowSpan={2}
                  className="text-right border-l-2 border-amber-200"
                  onClick={() => toggleSort("blog_saturation")}
                  sortActive={sortKey === "blog_saturation"}
                  sortDesc={sortDesc}
                  title="포화도(%) = 월간 블로그 발행 ÷ 월간 검색량 × 100. SEO 경쟁강도 지표 (낮을수록 진입 유리)."
                >
                  포화도
                  <br />
                  (경쟁강도)
                </Th>
                <Th rowSpan={2} onClick={() => toggleSort("shopping_category")} sortActive={sortKey === "shopping_category"} sortDesc={sortDesc}>
                  쇼핑 카테고리
                </Th>
                <Th colSpan={2} className="text-center">월평균 클릭수</Th>
                <Th colSpan={2} className="text-center">월평균 클릭율</Th>
                <Th rowSpan={2} onClick={() => toggleSort("comp_idx")} sortActive={sortKey === "comp_idx"} sortDesc={sortDesc}>
                  경쟁정도
                </Th>
                <Th rowSpan={2} className="text-right" onClick={() => toggleSort("pl_avg_depth")} sortActive={sortKey === "pl_avg_depth"} sortDesc={sortDesc}>
                  월평균
                  <br />
                  노출광고수
                </Th>
              </tr>
              <tr className="text-neutral-500 text-[11px]">
                <Th onClick={() => toggleSort("monthly_pc_qc")} sortActive={sortKey === "monthly_pc_qc"} sortDesc={sortDesc}>PC</Th>
                <Th onClick={() => toggleSort("monthly_mobile_qc")} sortActive={sortKey === "monthly_mobile_qc"} sortDesc={sortDesc}>Mobile</Th>
                <Th onClick={() => toggleSort("monthly_ave_pc_clk")} sortActive={sortKey === "monthly_ave_pc_clk"} sortDesc={sortDesc}>PC</Th>
                <Th onClick={() => toggleSort("monthly_ave_mobile_clk")} sortActive={sortKey === "monthly_ave_mobile_clk"} sortDesc={sortDesc}>Mobile</Th>
                <Th onClick={() => toggleSort("monthly_ave_pc_ctr")} sortActive={sortKey === "monthly_ave_pc_ctr"} sortDesc={sortDesc}>PC</Th>
                <Th onClick={() => toggleSort("monthly_ave_mobile_ctr")} sortActive={sortKey === "monthly_ave_mobile_ctr"} sortDesc={sortDesc}>Mobile</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="text-center text-neutral-400 py-8 text-sm">
                    키워드를 조회하십시오.
                  </td>
                </tr>
              ) : (
                rows.flatMap((r, idx) => {
                  const expanded = expandedRow === r.keyword;
                  const research = researchByKeyword[r.keyword];
                  return [
                    <Row
                      key={r.keyword}
                      row={r}
                      no={idx + 1}
                      checked={selected.has(r.keyword)}
                      isMain={mainKeyword === r.keyword}
                      isExpanded={expanded}
                      isRecommended={isRecommended(r, recommendVolume)}
                      onToggle={() => toggleSelect(r.keyword)}
                      onSelectMain={() => setMainKeyword(r.keyword)}
                      onToggleResearch={() => toggleResearch(r.keyword)}
                      onShowTrend={() => openTrend(r.keyword)}
                    />,
                    expanded ? (
                      <tr key={`${r.keyword}-detail`} className="bg-neutral-50">
                        <td colSpan={15} className="px-4 py-3">
                          <ResearchPanel
                            data={research}
                            selectedLinks={researchSelected}
                            onToggleSelect={toggleResearchSelect}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ].filter(Boolean);
                })
              )}
            </tbody>
          </table>
        </div>

        {mutation.data && (
          <p className="text-xs text-neutral-400">
            소스: {mutation.data.source} · 입력 {mutation.data.queried_keywords.length}개 → 결과 {rows.length}개
            {intentFilter !== "all" && ` (전체 ${mutation.data.results.length})`}
          </p>
        )}
      </div>

      {trendKeyword && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4"
          onClick={() => {
            setTrendKeyword(null);
            setTrend(null);
          }}
        >
          <div
            className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-neutral-700" />
                  검색 트렌드 — {trendKeyword}
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Naver DataLab · 최근 12개월 · 비율 (최고치 100 기준)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTrendKeyword(null);
                  setTrend(null);
                }}
                className="text-neutral-400 hover:text-neutral-700 text-xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </header>
            <div className="p-4 overflow-auto">
              {trend === "loading" && (
                <p className="text-sm text-neutral-400 py-8 text-center">불러오는 중...</p>
              )}
              {trend && typeof trend === "object" && "error" in trend && (
                <p className="text-sm text-red-600 py-8 text-center">{trend.error}</p>
              )}
              {trend && typeof trend === "object" && "data" in trend && (
                <LineChart
                  data={trend.data.map((p) => ({
                    label: p.period.slice(0, 7),
                    value: p.ratio,
                  }))}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Th({
  children,
  className = "",
  rowSpan,
  colSpan,
  onClick,
  sortActive,
  sortDesc,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  rowSpan?: number;
  colSpan?: number;
  onClick?: () => void;
  sortActive?: boolean;
  sortDesc?: boolean;
  title?: string;
}) {
  const clickable = !!onClick;
  // 정렬 가능한 컬럼: 비활성이면 흐린 더블 화살표, 활성이면 진한 단일 화살표
  const indicator = !clickable ? null : sortActive ? (
    sortDesc ? (
      <ArrowDown className="w-3 h-3 text-neutral-900" />
    ) : (
      <ArrowUp className="w-3 h-3 text-neutral-900" />
    )
  ) : (
    <ArrowUpDown className="w-3 h-3 text-neutral-300" />
  );

  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      onClick={onClick}
      title={title}
      aria-sort={sortActive ? (sortDesc ? "descending" : "ascending") : undefined}
      className={`px-2 py-2 text-left font-medium border-r last:border-r-0 ${clickable ? "cursor-pointer hover:bg-neutral-100 select-none" : ""} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {indicator}
      </span>
    </th>
  );
}

function Row({
  row,
  no,
  checked,
  isMain,
  isExpanded,
  isRecommended,
  onToggle,
  onSelectMain,
  onToggleResearch,
  onShowTrend,
}: {
  row: KeywordMetric;
  no: number;
  checked: boolean;
  isMain: boolean;
  isExpanded: boolean;
  isRecommended: boolean;
  onToggle: () => void;
  onSelectMain: () => void;
  onToggleResearch: () => void;
  onShowTrend: () => void;
}) {
  const rowBg = isMain
    ? "bg-brand-50"
    : isRecommended
      ? "bg-amber-50/40"
      : "";
  return (
    <tr className={`border-b hover:bg-neutral-50 ${rowBg}`}>
      <td className="px-2 py-1.5 text-center">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          type="radio"
          name="main_keyword"
          checked={isMain}
          onChange={onSelectMain}
          aria-label={`${row.keyword}를 메인 키워드로 지정`}
        />
      </td>
      <td className="px-2 py-1.5 text-center text-neutral-500">{no}</td>
      <td className="px-2 py-1.5">
        <div className="font-medium whitespace-normal break-keep flex items-center gap-1.5">
          {isRecommended && (
            <Tooltip text="SEO 추천 키워드 — 검색량·포화도 기준 통과">
              <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
            </Tooltip>
          )}
          <span>{row.keyword}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          <Tooltip text={`의도: ${INTENT_LABELS[row.intent]}`}>
            <span
              className={`text-[10px] rounded px-1.5 py-0.5 border ${INTENT_COLORS[row.intent]}`}
            >
              {INTENT_LABELS[row.intent]}
            </span>
          </Tooltip>
          {row.from_autocomplete && (
            <Tooltip text="자동완성에서만 발견된 키워드 (검색광고 응답엔 없었음)">
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" />
                자동완성
              </span>
            </Tooltip>
          )}
          <Tooltip text="12개월 트렌드 (Naver DataLab) 보기">
            <button
              type="button"
              onClick={onShowTrend}
              className="text-[10px] border rounded px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 inline-flex items-center gap-0.5"
            >
              <TrendingUp className="w-2.5 h-2.5" />
              트렌드
            </button>
          </Tooltip>
          <Tooltip text="이 키워드의 상위 블로그 글 미리보기">
            <button
              type="button"
              onClick={onToggleResearch}
              className="text-[10px] border rounded px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 inline-flex items-center gap-0.5"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-2.5 h-2.5" />
                  닫기
                </>
              ) : (
                <>
                  <ChevronDown className="w-2.5 h-2.5" />
                  상위블로그
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">{fmt(row.monthly_pc_qc)}</td>
      <td className="px-2 py-1.5 text-right">{fmt(row.monthly_mobile_qc)}</td>
      <td className="px-2 py-1.5 text-right font-semibold">{fmt(row.total_qc)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.blog_monthly_count)}</td>
      <td className="px-2 py-1.5 text-right border-l-2 border-amber-200">
        <SaturationBadge value={row.blog_saturation} />
      </td>
      <td className="px-2 py-1.5">{row.shopping_category ?? "-"}</td>
      <td className="px-2 py-1.5 text-right">{fmtDec(row.monthly_ave_pc_clk)}</td>
      <td className="px-2 py-1.5 text-right">{fmtDec(row.monthly_ave_mobile_clk)}</td>
      <td className="px-2 py-1.5 text-right">{fmtPct(row.monthly_ave_pc_ctr)}</td>
      <td className="px-2 py-1.5 text-right">{fmtPct(row.monthly_ave_mobile_ctr)}</td>
      <td className="px-2 py-1.5">{row.comp_idx ?? "-"}</td>
      <td className="px-2 py-1.5 text-right">{fmtDec(row.pl_avg_depth)}</td>
    </tr>
  );
}

function ResearchPanel({
  data,
  selectedLinks,
  onToggleSelect,
}: {
  data: ResearchResponse | "loading" | { error: string } | undefined;
  selectedLinks: Set<string>;
  onToggleSelect: (link: string) => void;
}) {
  if (!data || data === "loading") {
    return <p className="text-xs text-neutral-500">상위 블로그 페치 중... (본문 스크래핑 포함, 최대 10초)</p>;
  }
  if ("error" in data) {
    return <p className="text-xs text-red-600">에러: {data.error}</p>;
  }
  if (data.items.length === 0) {
    return <p className="text-xs text-neutral-500">검색 결과 없음.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-neutral-500">
        선택한 항목은 "글 생성으로 보내기" 시 LLM 프롬프트에 함께 포함됩니다.
      </p>
      <ul className="space-y-1.5">
        {data.items.map((it, i) => {
          const checked = selectedLinks.has(it.link);
          return (
            <li
              key={it.link}
              className={`text-xs border rounded px-2 py-1.5 bg-white ${checked ? "border-brand" : "border-neutral-200"}`}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleSelect(it.link)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-400 w-5">{i + 1}.</span>
                    <a
                      href={it.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {it.title}
                    </a>
                    <span className="text-neutral-400 text-[10px]">
                      {it.bloggername} · {it.body ? `본문 ${it.body.length}자` : "본문 없음"}
                    </span>
                  </div>
                  {it.description && (
                    <p className="text-neutral-600 mt-0.5 line-clamp-2">{it.description}</p>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 포화도(%) 시각화 — SEO 경쟁강도 직관 파악용.
 *  ~50%   매우 좋음 (수요 > 공급)
 *  ~100%  보통
 *  ~200%  빡빡함
 *  200%+  매우 빡빡함
 */
function SaturationBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-300">-</span>;
  let cls = "text-neutral-700 bg-neutral-50";
  let label = "보통";
  if (value < 50) {
    cls = "text-green-700 bg-green-50";
    label = "매우 좋음";
  } else if (value < 100) {
    cls = "text-amber-700 bg-amber-50";
    label = "보통";
  } else if (value < 200) {
    cls = "text-orange-700 bg-orange-50";
    label = "빡빡함";
  } else {
    cls = "text-red-700 bg-red-50";
    label = "매우 빡빡함";
  }
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-semibold tabular-nums ${cls}`}
      title={`${value.toLocaleString()}% — ${label}`}
    >
      {value.toLocaleString()}%
    </span>
  );
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString();
}
function fmtDec(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toFixed(1);
}
function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return `${n.toFixed(2)}%`;
}
function esc(s: string | number) {
  const str = String(s);
  return str.includes(",") || str.includes('"')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}
