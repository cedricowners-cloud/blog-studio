"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lightbulb, Minus, Plus, RotateCcw } from "lucide-react";
import { contentService } from "@/lib/content-service";
import { CardPreview, type CardData } from "@/components/card-preview";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  listDomains,
  loadDomainPack,
  EMPTY_CARD_DESIGN,
  type CardDesign,
  type DomainRow,
} from "@/lib/ontology/domain-loader";

const HANDOFF_CARDS_KEY = "blog_studio:handoff_cards";

type Card = Record<string, unknown>;
type ViewMode = "preview" | "edit";

const FIELDS_BY_TYPE: Record<string, string[]> = {
  cover: ["eyebrow", "main_title", "sub_title"],
  content: ["section_label", "heading", "lead", "body_text"],
  list: ["section_label", "heading"],
  closing: ["message", "cta"],
};

export default function CardsPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [keywords, setKeywords] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [provider, setProvider] = useState<"gemini" | "openai" | "anthropic">(
    "gemini",
  );
  const [cards, setCards] = useState<Card[] | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  // 카드 총 개수 — auto: 본문 섹션 수에 따라 자동 (cover+content+summary+closing).
  // 숫자 지정 시 강제 (최소 4, 최대 20). 4 = cover+1 content+summary+closing
  const [cardCountMode, setCardCountMode] = useState<"auto" | "manual">("auto");
  const [cardCountManual, setCardCountManual] = useState<number>(8);
  // 우상단 페이지 번호 (전역 토글)
  const [showPageBadge, setShowPageBadge] = useState<boolean>(true);
  // 카드별 글자 크기 배율 (cardIndex → 0.5~2)
  const [fontScales, setFontScales] = useState<Record<number, number>>({});

  function getFontScale(idx: number): number {
    return fontScales[idx] ?? 1;
  }

  function adjustFontScale(idx: number, delta: number) {
    setFontScales((prev) => {
      const cur = prev[idx] ?? 1;
      const next = Math.max(0.5, Math.min(2, Math.round((cur + delta) * 100) / 100));
      return { ...prev, [idx]: next };
    });
  }

  function resetFontScale(idx: number) {
    setFontScales((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }
  const [downloading, setDownloading] = useState<number | "all" | null>(null);
  const exportRefs = useRef<Array<HTMLDivElement | null>>([]);

  // 도메인 카드 디자인 — 핸드오프 시 domain_code 받거나, UI에서 변경
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [domainCode, setDomainCode] = useState<string>("");
  const [cardDesign, setCardDesign] = useState<CardDesign>(EMPTY_CARD_DESIGN);

  // 도메인 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const list = await listDomains(sb);
        setDomains(list);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 선택된 도메인의 cardDesign 자동 로드
  useEffect(() => {
    if (!domainCode) {
      setCardDesign(EMPTY_CARD_DESIGN);
      return;
    }
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const pack = await loadDomainPack(sb, domainCode);
        setCardDesign(pack.cardDesign);
      } catch {
        setCardDesign(EMPTY_CARD_DESIGN);
      }
    })();
  }, [domainCode]);

  // /generate 또는 /posts/[id] 에서 "→ 카드뉴스 만들기"로 들어왔으면 자동 채움
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(HANDOFF_CARDS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        title?: string;
        body?: string;
        keywords?: string[];
        domain_code?: string;
      };
      if (data.title) setTitle(data.title);
      if (data.body) setBody(data.body);
      if (data.keywords?.length) setKeywords(data.keywords.join(", "));
      if (data.domain_code) setDomainCode(data.domain_code);
      sessionStorage.removeItem(HANDOFF_CARDS_KEY); // 1회용
    } catch {
      /* ignore */
    }
  }, []);

  const build = useMutation({
    mutationFn: () =>
      contentService.cardsBuild({
        title,
        body,
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        use_ai: useAi,
        provider,
        card_count: cardCountMode === "auto" ? "auto" : cardCountManual,
      }),
    onSuccess: (data) => setCards(data.cards),
  });

  const rows = useMemo(() => flattenCardsToRows(cards ?? []), [cards]);

  function updateCell(rowIdx: number, value: string) {
    if (!cards) return;
    const row = rows[rowIdx];
    const updated = [...cards];
    const c = { ...(updated[row.cardIndex] as Card) };
    if (row.field.startsWith("items[")) {
      const i = Number(row.field.slice(6, -1));
      const items = [...(((c.items as string[]) || []))];
      while (items.length <= i) items.push("");
      items[i] = value;
      c.items = items;
    } else {
      c[row.field] = value;
    }
    updated[row.cardIndex] = c;
    setCards(updated);
  }

  function downloadJson() {
    if (!cards) return;
    const blob = new Blob([JSON.stringify(cards, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cards_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadPng(idx: number) {
    const node = exportRefs.current[idx];
    if (!node) return;
    setDownloading(idx);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: 1, // 카드 내부가 이미 1080×1080 → 그대로
        useCORS: true,
        logging: false,
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `card_${String(idx + 1).padStart(2, "0")}_${Date.now()}.png`;
      a.click();
    } finally {
      setDownloading(null);
    }
  }

  async function downloadAllPng() {
    if (!cards) return;
    setDownloading("all");
    try {
      const html2canvas = (await import("html2canvas")).default;
      for (let i = 0; i < cards.length; i++) {
        const node = exportRefs.current[i];
        if (!node) continue;
        const canvas = await html2canvas(node, {
          backgroundColor: "#ffffff",
          scale: 1,
          useCORS: true,
          logging: false,
        });
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `card_${String(i + 1).padStart(2, "0")}_${Date.now()}.png`;
        a.click();
        // 브라우저가 동시 다운로드 막지 않도록 살짝 간격
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-bold">카드뉴스 편집</h1>
          <p className="text-sm text-neutral-500 mt-1">
            블로그 본문 → AI 요약 → 카드 텍스트 편집. PNG 렌더링은 로컬 에이전트에서 처리.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            build.mutate();
          }}
          className="grid gap-3 bg-white border rounded-lg p-5"
        >
          <label className="block">
            <span className="text-sm font-medium">제목</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">본문</span>
            <textarea
              required
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="[h2] 마크업이 포함된 블로그 본문 전체 붙여넣기"
              className="mt-1 w-full border rounded px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">키워드 (쉼표 구분)</span>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-neutral-600">도메인 디자인:</span>
              <select
                value={domainCode}
                onChange={(e) => setDomainCode(e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="">(기본 navy)</option>
                {domains.map((d) => (
                  <option key={d.domain_code} value={d.domain_code}>
                    {d.domain_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-neutral-600">카드 수</span>
              <select
                value={cardCountMode}
                onChange={(e) => setCardCountMode(e.target.value as "auto" | "manual")}
                className="border rounded px-2 py-1"
              >
                <option value="auto">자동 (본문 섹션 수)</option>
                <option value="manual">직접 지정</option>
              </select>
              {cardCountMode === "manual" && (
                <input
                  type="number"
                  min={4}
                  max={20}
                  value={cardCountManual}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v >= 4 && v <= 20) setCardCountManual(v);
                  }}
                  className="w-16 border rounded px-2 py-1 text-sm"
                />
              )}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
              />
              AI 요약 사용
            </label>
            <select
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as "gemini" | "openai" | "anthropic")
              }
              disabled={!useAi}
              className="border rounded px-2 py-1"
            >
              <option value="gemini">gemini</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
            </select>
            <button
              type="submit"
              disabled={build.isPending}
              className="ml-auto bg-brand text-white rounded px-5 py-2 font-medium disabled:opacity-50"
            >
              {build.isPending ? "생성 중..." : "카드 생성"}
            </button>
          </div>
        </form>

        {build.error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {(build.error as Error).message}
          </div>
        )}

        {cards && (
          <section className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold">{cards.length} 카드</h2>
                <div className="inline-flex border rounded overflow-hidden text-xs">
                  <button
                    onClick={() => setViewMode("preview")}
                    className={`px-3 py-1 ${viewMode === "preview" ? "bg-brand text-white" : "bg-white"}`}
                  >
                    미리보기
                  </button>
                  <button
                    onClick={() => setViewMode("edit")}
                    className={`px-3 py-1 ${viewMode === "edit" ? "bg-brand text-white" : "bg-white"}`}
                  >
                    편집
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <label className="flex items-center gap-1.5 text-xs text-neutral-700 cursor-pointer border rounded px-2 py-1">
                  <input
                    type="checkbox"
                    checked={showPageBadge}
                    onChange={(e) => setShowPageBadge(e.target.checked)}
                  />
                  페이지 번호 표시
                </label>
                <button
                  onClick={downloadAllPng}
                  disabled={downloading !== null}
                  className="text-sm bg-brand text-white rounded px-3 py-1 disabled:opacity-50"
                >
                  {downloading === "all" ? "PNG 일괄 다운로드 중..." : "↓ 전체 PNG"}
                </button>
                <button
                  onClick={downloadJson}
                  className="text-sm border rounded px-3 py-1"
                >
                  ↓ JSON
                </button>
              </div>
            </div>

            <p className="text-[11px] text-neutral-400 inline-flex items-center gap-1">
              <Lightbulb className="w-3 h-3" />
              편집 탭에서 텍스트 안에 Enter 키를 누르면 카드 안에서도 줄바꿈이 적용됩니다.
            </p>

            {viewMode === "preview" ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {cards.map((c, i) => {
                  const scale = getFontScale(i);
                  return (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <CardPreview
                        card={c as CardData}
                        index={i}
                        total={cards.length}
                        design={cardDesign}
                        showPageBadge={showPageBadge}
                        fontScale={scale}
                      />
                      {/* 카드별 글자 크기 조절 */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-neutral-500 mr-1">글자</span>
                        <button
                          type="button"
                          onClick={() => adjustFontScale(i, -0.1)}
                          disabled={scale <= 0.5}
                          className="border rounded p-1 hover:bg-neutral-50 disabled:opacity-30"
                          title="작게"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-10 text-center font-mono text-neutral-700">
                          {scale.toFixed(1)}x
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustFontScale(i, 0.1)}
                          disabled={scale >= 2}
                          className="border rounded p-1 hover:bg-neutral-50 disabled:opacity-30"
                          title="크게"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        {scale !== 1 && (
                          <button
                            type="button"
                            onClick={() => resetFontScale(i)}
                            className="border rounded p-1 hover:bg-neutral-50 text-neutral-500"
                            title="기본 크기로 복원"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => downloadPng(i)}
                        disabled={downloading !== null}
                        className="text-xs border rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {downloading === i ? "변환 중..." : `↓ PNG #${String(i + 1).padStart(2, "0")}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th className="px-2 py-2 w-24">카드</th>
                    <th className="px-2 py-2 w-40">필드</th>
                    <th className="px-2 py-2">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="px-2 py-2 text-xs text-neutral-500">{r.cardLabel}</td>
                      <td className="px-2 py-2 text-xs font-mono">{r.field}</td>
                      <td className="px-2 py-2">
                        <textarea
                          value={r.value}
                          onChange={(e) => updateCell(i, e.target.value)}
                          rows={Math.min(4, Math.max(1, r.value.split("\n").length))}
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* PNG export용 풀사이즈(1080×1080) 카드 — 화면에는 안 보이게 숨김 */}
        {cards && (
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: -10000,
              top: 0,
              width: 1080,
              height: "auto",
              pointerEvents: "none",
            }}
          >
            {cards.map((c, i) => (
              <CardPreview
                key={i}
                ref={(el) => {
                  exportRefs.current[i] = el;
                }}
                card={c as CardData}
                index={i}
                total={cards.length}
                fullSize
                design={cardDesign}
                showPageBadge={showPageBadge}
                fontScale={getFontScale(i)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

interface FlatRow {
  cardIndex: number;
  cardLabel: string;
  field: string;
  value: string;
}

function flattenCardsToRows(cards: Card[]): FlatRow[] {
  const rows: FlatRow[] = [];
  cards.forEach((card, i) => {
    const type = String(card.type ?? "unknown");
    const baseLabel = `${String(i + 1).padStart(2, "0")} · ${type}`;
    const label =
      type === "content"
        ? `${baseLabel} · ${String(card.section_label ?? "")}`
        : baseLabel;

    for (const f of FIELDS_BY_TYPE[type] ?? []) {
      rows.push({
        cardIndex: i,
        cardLabel: label,
        field: f,
        value: String(card[f] ?? ""),
      });
    }
    if (type === "list") {
      const items = (card.items as string[]) || [];
      items.forEach((_, idx) => {
        rows.push({
          cardIndex: i,
          cardLabel: label,
          field: `items[${idx}]`,
          value: String(items[idx] ?? ""),
        });
      });
    }
  });
  return rows;
}
