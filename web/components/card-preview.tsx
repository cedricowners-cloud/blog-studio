"use client";

/**
 * 카드뉴스 슬라이드 미리보기 컴포넌트.
 * cover / content / list / closing 4가지 카드 타입을 시각적으로 렌더링.
 *
 * 카드 크기: 1080×1080 (정사각, 인스타용 표준).
 * 미리보기에서는 width:340px (CSS scale) — PNG export 시 transform: scale(1)로 원본 크기로.
 *
 * 색상·폰트는 도메인의 cardDesign 에서 받음 (없으면 기본 navy).
 */
import { forwardRef } from "react";
import { EMPTY_CARD_DESIGN, type CardDesign } from "@/lib/ontology/domain-loader";

export type CardData = Record<string, unknown>;

interface CardPreviewProps {
  card: CardData;
  index: number;
  total: number;
  /** PNG export 모드 (full size). 기본 false (썸네일 320px) */
  fullSize?: boolean;
  /** 카드 디자인 — 없으면 기본 navy */
  design?: CardDesign;
  /** 우상단 페이지 번호 표시 여부 (기본 true) */
  showPageBadge?: boolean;
  /** 모든 텍스트 크기 배율 (0.5 ~ 2, 기본 1) */
  fontScale?: number;
}

export const CardPreview = forwardRef<HTMLDivElement, CardPreviewProps>(
  function CardPreview(
    { card, index, total, fullSize = false, design, showPageBadge = true, fontScale = 1 },
    ref,
  ) {
    const d = design ?? EMPTY_CARD_DESIGN;
    const type = String(card.type ?? "unknown");
    const W = 1080;
    const H = 1080;
    const SCALE = fullSize ? 1 : 320 / W;
    // 안전 범위로 클램프
    const fs = Math.max(0.5, Math.min(2, fontScale));

    const containerStyle: React.CSSProperties = {
      width: W * SCALE,
      height: H * SCALE,
      position: "relative",
    };

    const innerStyle: React.CSSProperties = {
      width: W,
      height: H,
      transform: `scale(${SCALE})`,
      transformOrigin: "top left",
      position: "absolute",
      top: 0,
      left: 0,
      backgroundColor: d.colors.background,
      overflow: "hidden",
      boxSizing: "border-box",
      fontFamily: `${d.font_family}, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`,
    };

    return (
      <div
        ref={ref}
        style={containerStyle}
        className="rounded-lg overflow-hidden border border-neutral-200 shadow-sm bg-white"
      >
        <div style={innerStyle}>
          {type === "cover" && (
            <CoverCard card={card} index={index} total={total} d={d} fs={fs} showBadge={showPageBadge} />
          )}
          {type === "content" && (
            <ContentCard card={card} index={index} total={total} d={d} fs={fs} showBadge={showPageBadge} />
          )}
          {type === "list" && (
            <ListCard card={card} index={index} total={total} d={d} fs={fs} showBadge={showPageBadge} />
          )}
          {type === "closing" && (
            <ClosingCard card={card} index={index} total={total} d={d} fs={fs} showBadge={showPageBadge} />
          )}
          {!["cover", "content", "list", "closing"].includes(type) && (
            <FallbackCard card={card} d={d} />
          )}
        </div>
      </div>
    );
  },
);

function PageBadge({
  index,
  total,
  color,
  fs,
}: {
  index: number;
  total: number;
  color: string;
  fs: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 60,
        fontSize: 32 * fs,
        fontWeight: 600,
        color,
        letterSpacing: 2,
      }}
    >
      {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
    </div>
  );
}

function CoverCard({
  card,
  index,
  total,
  d,
  fs,
  showBadge,
}: {
  card: CardData;
  index: number;
  total: number;
  d: CardDesign;
  fs: number;
  showBadge: boolean;
}) {
  const eyebrow = String(card.eyebrow ?? "BLOG");
  const main = String(card.main_title ?? "");
  const sub = String(card.sub_title ?? "");
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${d.colors.primary} 0%, ${d.colors.primary_gradient_to} 100%)`,
        color: "#ffffff",
        padding: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxSizing: "border-box",
      }}
    >
      {showBadge && <PageBadge index={index} total={total} color="rgba(255,255,255,0.7)" fs={fs} />}
      <div style={{ fontSize: 36 * fs, letterSpacing: 8, fontWeight: 600, opacity: 0.9 }}>
        {eyebrow}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        <h1
          style={{
            fontSize: 88 * fs,
            fontWeight: 800,
            lineHeight: 1.25,
            margin: 0,
            wordBreak: "keep-all",
            whiteSpace: "pre-wrap",
          }}
        >
          {main}
        </h1>
      </div>
      {sub && (
        <div
          style={{
            fontSize: 38 * fs,
            opacity: 0.85,
            wordBreak: "keep-all",
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
          }}
        >
          {sub}
        </div>
      )}
      {d.brand_name && (
        <div style={{ fontSize: 26 * fs, opacity: 0.7, letterSpacing: 1 }}>{d.brand_name}</div>
      )}
    </div>
  );
}

function ContentCard({
  card,
  index,
  total,
  d,
  fs,
  showBadge,
}: {
  card: CardData;
  index: number;
  total: number;
  d: CardDesign;
  fs: number;
  showBadge: boolean;
}) {
  const sectionLabel = String(card.section_label ?? "");
  const heading = String(card.heading ?? "");
  const lead = String(card.lead ?? "");
  const body = String(card.body_text ?? "");
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: d.colors.background,
        padding: 80,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {showBadge && <PageBadge index={index} total={total} color={d.colors.page_badge} fs={fs} />}

      <div
        style={{
          fontSize: 32 * fs,
          fontWeight: 700,
          color: d.colors.primary,
          letterSpacing: 4,
          marginBottom: 30,
        }}
      >
        {sectionLabel}
      </div>

      <h2
        style={{
          fontSize: 72 * fs,
          fontWeight: 800,
          lineHeight: 1.3,
          color: d.colors.text_dark,
          margin: 0,
          marginBottom: 50,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
          paddingBottom: 30,
          borderBottom: `8px solid ${d.colors.primary}`,
        }}
      >
        {heading}
      </h2>

      <div
        style={{
          fontSize: 50 * fs,
          fontWeight: 700,
          color: d.colors.text_dark,
          lineHeight: 1.5,
          marginBottom: 40,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {lead}
      </div>

      <div
        style={{
          fontSize: 36 * fs,
          color: d.colors.text_muted,
          lineHeight: 1.7,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
          flex: 1,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function ListCard({
  card,
  index,
  total,
  d,
  fs,
  showBadge,
}: {
  card: CardData;
  index: number;
  total: number;
  d: CardDesign;
  fs: number;
  showBadge: boolean;
}) {
  const sectionLabel = String(card.section_label ?? "SUMMARY");
  const heading = String(card.heading ?? "");
  const items = (card.items as string[] | undefined) ?? [];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: d.colors.list_background,
        padding: 80,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {showBadge && <PageBadge index={index} total={total} color={d.colors.page_badge} fs={fs} />}

      <div
        style={{
          fontSize: 32 * fs,
          fontWeight: 700,
          color: d.colors.primary,
          letterSpacing: 4,
          marginBottom: 30,
        }}
      >
        {sectionLabel}
      </div>

      <h2
        style={{
          fontSize: 72 * fs,
          fontWeight: 800,
          lineHeight: 1.3,
          color: d.colors.text_dark,
          margin: 0,
          marginBottom: 60,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {heading}
      </h2>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
        {items.slice(0, 5).map((item, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 30,
              marginBottom: 36,
              fontSize: 44 * fs,
              color: d.colors.text_dark,
              lineHeight: 1.4,
              wordBreak: "keep-all",
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                flexShrink: 0,
                backgroundColor: d.colors.accent,
                color: "#ffffff",
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28 * fs,
                fontWeight: 800,
              }}
            >
              {i + 1}
            </div>
            <span style={{ flex: 1, paddingTop: 8, whiteSpace: "pre-wrap" }}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClosingCard({
  card,
  index,
  total,
  d,
  fs,
  showBadge,
}: {
  card: CardData;
  index: number;
  total: number;
  d: CardDesign;
  fs: number;
  showBadge: boolean;
}) {
  const message = String(card.message ?? "");
  const cta = String(card.cta ?? "");
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${d.colors.closing_gradient_from} 0%, ${d.colors.closing_gradient_to} 100%)`,
        color: "#ffffff",
        padding: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        boxSizing: "border-box",
      }}
    >
      {showBadge && <PageBadge index={index} total={total} color="rgba(255,255,255,0.5)" fs={fs} />}
      <div
        style={{
          fontSize: 60 * fs,
          fontWeight: 700,
          lineHeight: 1.5,
          marginBottom: 60,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {message}
      </div>
      <div
        style={{
          fontSize: 38 * fs,
          opacity: 0.85,
          padding: "24px 56px",
          border: "4px solid rgba(255,255,255,0.4)",
          borderRadius: 999,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {cta}
      </div>
      {d.brand_name && (
        <div style={{ fontSize: 28 * fs, opacity: 0.6, marginTop: 60, letterSpacing: 1 }}>
          — {d.brand_name}
        </div>
      )}
    </div>
  );
}

function FallbackCard({ card, d }: { card: CardData; d: CardDesign }) {
  return (
    <div
      style={{
        padding: 60,
        fontSize: 24,
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        color: d.colors.text_muted,
      }}
    >
      {JSON.stringify(card, null, 2)}
    </div>
  );
}
