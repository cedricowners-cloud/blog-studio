/**
 * 카드뉴스 파서 — 네이버 블로그 markup ([h2], [bold], [quote] 등)을 카드 데이터로 변환.
 *
 * shared_py/cards/parser.py 의 1:1 포팅. 정규식 패턴과 출력 스키마 동일.
 * AI 옵션 사용 시 content 카드의 lead/body_text를 자연스럽게 다시 씀.
 */
import { llmGenerate, type LLMProvider } from "./llm";

const H2_SPLIT = /\[h2\]([\s\S]*?)\[\/h2\]/g;
const IMG_PLACEHOLDER = /\[img_placeholder[^\]]*\]/g;
const QUOTE_BLOCK = /\[quote\][\s\S]*?\[\/quote\]/g;
const ITALIC_BLOCK = /\[italic\]([\s\S]*?)\[\/italic\]/g;
const MARKUP_TAG = /\[\/?(?:bold|italic|quote|hr|right|center|left|color[^\]]*|bg[^\]]*|size[^\]]*|font[^\]]*)\]/g;
const TABLE_ROW = /^\s*\|.*\|\s*$/gm;
// 마침표·물음표·느낌표 뒤 공백 OR 줄바꿈 = 문장 경계
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
// SEO 워크플로 산출물의 이미지 가이드 블록 제거 ("[이미지 제안]\n- 위치: ...\n- 유형: ...")
const IMAGE_GUIDE_BLOCK = /\[이미지\s*제안\][^[]*?(?=\n\n|\n#|$)/g;

function stripMarkup(text: string): string {
  let t = text.replace(IMG_PLACEHOLDER, "");
  t = t.replace(MARKUP_TAG, "");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

function cleanSectionBody(text: string): string {
  let t = text.replace(IMG_PLACEHOLDER, "");
  t = t.replace(QUOTE_BLOCK, "");
  t = t.replace(ITALIC_BLOCK, "");
  t = t.replace(TABLE_ROW, "");
  t = t.replace(/\[hr\]/g, "");
  return stripMarkup(t);
}

/**
 * 마크다운 본문 정리 — 헤더 안의 prose 정제용.
 * 줄바꿈은 "<br>" 사뮬레이션 없이 그대로 두고, splitSentences 가 \n 으로 분리하게 함.
 */
function cleanMarkdownContent(text: string): string {
  let t = text;
  // SEO 워크플로 step 5 의 이미지 가이드 블록 제거
  t = t.replace(IMAGE_GUIDE_BLOCK, "");
  // 이미지 / 링크
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 인라인 마크다운
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  // 블록 마커 (각 줄 시작)
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^[-*+]\s+/gm, "");
  t = t.replace(/^\d+\.\s+/gm, "");
  t = t.replace(/^-{3,}\s*$/gm, "");
  // 표
  t = t.replace(/\|/g, " ");
  // 연속 공백 정리 (단, 줄바꿈은 보존)
  t = t.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n");
  // 빈 줄 압축
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function truncate(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).replace(/[ ,.·]+$/, "") + "…";
}

export interface ParsedSection {
  heading: string;
  sentences: string[];
}

/**
 * 본문 형식 자동 감지:
 *   1) Naver 블로그 마크업 [h2]...[/h2]
 *   2) Markdown 헤더 (# / ## / ###)
 *   3) 헤더 없으면 빈 줄로 분리된 문단을 각 섹션으로 (긴 prose 대응)
 */
export function parseSections(body: string): ParsedSection[] {
  if (body.includes("[h2]")) {
    return parseNaverSections(body);
  }
  const hasMarkdownHeading = /^#{1,3}\s+\S/m.test(body);
  if (hasMarkdownHeading) {
    return parseMarkdownSections(body);
  }
  return parseParagraphSections(body);
}

function parseNaverSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const parts = body.split(H2_SPLIT);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = stripMarkup(parts[i]);
    const content = parts[i + 1] ?? "";
    const cleaned = cleanSectionBody(content);
    sections.push({ heading, sentences: splitSentences(cleaned) });
  }
  return sections;
}

function parseMarkdownSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeading === null) return;
    const cleaned = cleanMarkdownContent(buffer.join("\n"));
    if (cleaned) {
      sections.push({ heading: currentHeading, sentences: splitSentences(cleaned) });
    }
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      flush();
      // ** 굵은 글씨 표기 제거
      currentHeading = m[2].replace(/\*\*/g, "").trim();
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function parseParagraphSections(body: string): ParsedSection[] {
  // 빈 줄 기준으로 분리, 각 문단을 한 섹션으로
  const cleaned = cleanMarkdownContent(body);
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .map((p, i) => {
      const sentences = splitSentences(p);
      if (sentences.length === 0) return null;
      const heading = truncate(sentences[0], 40) || `섹션 ${i + 1}`;
      return { heading, sentences };
    })
    .filter((s): s is ParsedSection => s !== null);
}

export type Card =
  | { type: "cover"; eyebrow: string; main_title: string; sub_title?: string }
  | { type: "content"; section_label: string; heading: string; lead: string; body_text: string }
  | { type: "list"; section_label: string; heading: string; items: string[] }
  | { type: "closing"; message: string; cta: string };

export interface BuildCardsOptions {
  title: string;
  body: string;
  keywords?: string[];
  maxContentCards?: number;
  cardCount?: number | "auto";
  ai?: { provider: LLMProvider; model?: string };
}

export async function buildCards(opts: BuildCardsOptions): Promise<Card[]> {
  const {
    title,
    body,
    keywords = [],
    // 기본값 10 (이전 5는 너무 적음). cardCount 로 명시 override 가능.
    maxContentCards = 10,
    cardCount = "auto",
    ai,
  } = opts;

  const sections = parseSections(body);

  let maxContent: number;
  if (typeof cardCount === "number" && cardCount > 0) {
    maxContent = Math.max(1, cardCount - 3);
  } else {
    maxContent = sections.length > 0 ? Math.min(sections.length, maxContentCards) : 0;
  }

  const cards: Card[] = [];

  // Cover
  const cover: Card = {
    type: "cover",
    eyebrow: "BLOG",
    main_title: stripMarkup(title),
  };
  if (sections.length > 0) {
    (cover as { sub_title?: string }).sub_title = truncate(sections[0].heading, 30);
  }
  cards.push(cover);

  // Content cards
  const usedSections = sections.slice(0, maxContent);
  usedSections.forEach((section, idx) => {
    const i = idx + 1;
    const lead = section.sentences[0] ?? "";
    // body는 첫 문장 다음의 1~2개 문장 합쳐서 더 풍성하게
    const bodyText = section.sentences.slice(1, 3).join(" ") || lead;
    cards.push({
      type: "content",
      section_label: `POINT ${String(i).padStart(2, "0")}`,
      heading: stripMarkup(section.heading),
      lead: truncate(lead, 60),
      body_text: truncate(bodyText, 140),
    });
  });

  // Keyword summary
  if (keywords.length > 0) {
    cards.push({
      type: "list",
      section_label: "SUMMARY",
      heading: stripMarkup("핵심 키워드 정리"),
      items: keywords.slice(0, 5).map((k) => truncate(k, 24)),
    });
  }

  // Closing
  cards.push({
    type: "closing",
    message: stripMarkup("자세한 내용은 블로그에서 확인하세요"),
    cta: "블로그 링크를 확인해주세요",
  });

  // AI rewrite (best-effort; 실패 시 규칙 기반 결과 유지)
  if (ai && usedSections.length > 0) {
    await rewriteContentCardsWithAI(cards, usedSections, title, ai);
  }

  return cards;
}

async function rewriteContentCardsWithAI(
  cards: Card[],
  sections: ParsedSection[],
  title: string,
  ai: { provider: LLMProvider; model?: string },
): Promise<void> {
  const contentItems: Array<{ cardIdx: number; section: ParsedSection }> = [];
  cards.forEach((card, cardIdx) => {
    if (card.type !== "content") return;
    const secIdx = contentItems.length;
    if (secIdx >= sections.length) return;
    contentItems.push({ cardIdx, section: sections[secIdx] });
  });

  if (contentItems.length === 0) return;

  const payload = contentItems.map((it, i) => ({
    index: i + 1,
    heading: (cards[it.cardIdx] as { heading: string }).heading,
    source: it.section.sentences.join(" ").slice(0, 600),
  }));

  const total = payload.length;
  const expectedIndexes = Array.from({ length: total }, (_, i) => i + 1).join(", ");
  const exampleItems = Array.from({ length: total }, (_, i) =>
    `{"index": ${i + 1}, "lead": "...", "body_text": "..."}`,
  ).join(",\n    ");

  const prompt = `
블로그 제목: ${title}

⚠️ 반드시 아래 섹션 **${total}개 전부**에 대해 카드뉴스 문구를 생성하세요.
⚠️ 응답 cards 배열의 길이는 정확히 ${total}개여야 하고, index는 ${expectedIndexes} 순서로 빠짐없이 포함되어야 합니다.
⚠️ 한 개라도 누락되면 실패로 간주합니다.

각 섹션(heading + source)을 기반으로 카드뉴스용 짧은 문구 2개를 만들어주세요.
- \`lead\`: 섹션의 핵심 1문장 (35~50자, 완전한 문장, 줄임표 금지)
- \`body_text\`: lead를 뒷받침하는 설명 1~2문장 (80~120자, 완전한 문장, 줄임표 금지)
- 원문에 없는 사실·수치 창작 금지. 원문을 요약·다듬는 수준.
- 문장을 중간에 자르거나 "…" 같은 기호를 쓰지 마세요.
- 존댓말 톤 유지.

섹션 데이터 (${total}개, JSON):
${JSON.stringify(payload, null, 2)}

아래 JSON 포맷으로만 응답하세요. 다른 설명·마크다운·코드펜스 금지:
{
  "cards": [
    ${exampleItems}
  ]
}
`.trim();

  const callAndParse = async (): Promise<Map<number, { lead?: string; body_text?: string }> | null> => {
    let raw: string;
    try {
      const result = await llmGenerate(prompt, { provider: ai.provider, model: ai.model, temperature: 0.5 });
      raw = result.text;
    } catch {
      return null;
    }
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const data = JSON.parse(match[0]) as { cards?: Array<{ index: number; lead?: string; body_text?: string }> };
      const map = new Map<number, { lead?: string; body_text?: string }>();
      (data.cards ?? []).forEach((it) => {
        if (typeof it.index === "number") map.set(it.index, it);
      });
      return map;
    } catch {
      return null;
    }
  };

  let rewrites = await callAndParse();
  if (rewrites) {
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((i) => !rewrites!.has(i));
    if (missing.length > 0) {
      const retry = await callAndParse();
      if (retry) {
        retry.forEach((v, k) => {
          if (!rewrites!.has(k)) rewrites!.set(k, v);
        });
      }
    }
  }
  if (!rewrites || rewrites.size === 0) return;

  contentItems.forEach((it, i) => {
    const rewrite = rewrites!.get(i + 1);
    if (!rewrite) return;
    const card = cards[it.cardIdx] as { lead: string; body_text: string };
    if (rewrite.lead?.trim()) card.lead = rewrite.lead.trim();
    if (rewrite.body_text?.trim()) card.body_text = rewrite.body_text.trim();
  });
}
