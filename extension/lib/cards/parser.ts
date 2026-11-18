// 블로그 본문을 카드 내용으로 바꾼다: 표지 한 장 + 소제목마다 한 장.
// 웹의 web/lib/cards-parser.ts 를 옮긴 것이다. 규칙으로 만드는 부분의 결과가 웹과 같은지는 tests/parity.test.ts 가 확인한다.
// 다른 점: AI 호출을 여기서 하지 않는다. 다듬기 프롬프트를 만들고, AI의 답을 카드에 반영하는 일만 한다.
import { fill, type PromptPack } from '../prompts/pack.ts';

const H2_SPLIT = /\[h2\]([\s\S]*?)\[\/h2\]/g;
const IMG_PLACEHOLDER = /\[img_placeholder[^\]]*\]/g;
const QUOTE_BLOCK = /\[quote\][\s\S]*?\[\/quote\]/g;
const ITALIC_BLOCK = /\[italic\]([\s\S]*?)\[\/italic\]/g;
const MARKUP_TAG = /\[\/?(?:bold|italic|quote|hr|right|center|left|color[^\]]*|bg[^\]]*|size[^\]]*|font[^\]]*)\]/g;
const TABLE_ROW = /^\s*\|.*\|\s*$/gm;
/** 마침표·물음표·느낌표 뒤의 빈칸, 또는 줄바꿈에서 문장을 나눈다 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
/** SEO 8단계 결과에 들어 있는 "[이미지 제안]" 덩어리 */
const IMAGE_GUIDE_BLOCK = /\[이미지\s*제안\][^[]*?(?=\n\n|\n#|$)/g;

function stripMarkup(text: string): string {
  let t = text.replace(IMG_PLACEHOLDER, '');
  t = t.replace(MARKUP_TAG, '');
  t = t.replace(/\s+/g, ' ');
  return t.trim();
}

function cleanSectionBody(text: string): string {
  let t = text.replace(IMG_PLACEHOLDER, '');
  t = t.replace(QUOTE_BLOCK, '');
  t = t.replace(ITALIC_BLOCK, '');
  t = t.replace(TABLE_ROW, '');
  t = t.replace(/\[hr\]/g, '');
  return stripMarkup(t);
}

function cleanMarkdownContent(text: string): string {
  let t = text;
  t = t.replace(IMAGE_GUIDE_BLOCK, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/^>\s*/gm, '');
  t = t.replace(/^[-*+]\s+/gm, '');
  t = t.replace(/^\d+\.\s+/gm, '');
  t = t.replace(/^-{3,}\s*$/gm, '');
  t = t.replace(/\|/g, ' ');
  t = t.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
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
  return t.slice(0, maxChars - 1).replace(/[ ,.·]+$/, '') + '…';
}

export interface ParsedSection {
  heading: string;
  sentences: string[];
}

/** 본문에 소제목이 있는지. 없으면 문단마다 한 덩어리로 본다 */
export type BodyShape = 'markup' | 'markdown' | 'paragraphs';

export function bodyShape(body: string): BodyShape {
  if (body.includes('[h2]')) return 'markup';
  return /^#{1,3}\s+\S/m.test(body) ? 'markdown' : 'paragraphs';
}

export function parseSections(body: string): ParsedSection[] {
  const shape = bodyShape(body);
  if (shape === 'markup') return parseNaverSections(body);
  if (shape === 'markdown') return parseMarkdownSections(body);
  return parseParagraphSections(body);
}

function parseNaverSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const parts = body.split(H2_SPLIT);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = stripMarkup(parts[i] ?? '');
    const cleaned = cleanSectionBody(parts[i + 1] ?? '');
    sections.push({ heading, sentences: splitSentences(cleaned) });
  }
  return sections;
}

function parseMarkdownSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeading === null) return;
    const cleaned = cleanMarkdownContent(buffer.join('\n'));
    if (cleaned) sections.push({ heading: currentHeading, sentences: splitSentences(cleaned) });
  };

  for (const line of body.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      flush();
      currentHeading = (m[2] ?? '').replace(/\*\*/g, '').trim();
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function parseParagraphSections(body: string): ParsedSection[] {
  const cleaned = cleanMarkdownContent(body);
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sections: ParsedSection[] = [];
  paragraphs.forEach((p, i) => {
    const sentences = splitSentences(p);
    if (sentences.length === 0) return;
    sections.push({ heading: truncate(sentences[0] ?? '', 40) || `섹션 ${i + 1}`, sentences });
  });
  return sections;
}

export type Card =
  | { type: 'cover'; eyebrow: string; main_title: string; sub_title?: string }
  | { type: 'content'; section_label: string; heading: string; lead: string; body_text: string }
  | { type: 'list'; section_label: string; heading: string; items: string[] }
  | { type: 'closing'; message: string; cta: string };

export interface BuildCardsOptions {
  title: string;
  body: string;
  keywords?: string[];
  maxContentCards?: number;
  cardCount?: number | 'auto';
}

export interface BuiltCards {
  cards: Card[];
  /** 내용 카드를 만든 소제목 덩어리. 내용 카드와 순서가 같다 */
  usedSections: ParsedSection[];
}

/** 규칙으로 카드를 만든다 (AI 없이). 웹의 buildCards 에서 AI 다듬기를 뺀 것과 같다. */
export function buildCards(opts: BuildCardsOptions): BuiltCards {
  const { title, body, keywords = [], maxContentCards = 10, cardCount = 'auto' } = opts;
  const sections = parseSections(body);

  let maxContent: number;
  if (typeof cardCount === 'number' && cardCount > 0) maxContent = Math.max(1, cardCount - 3);
  else maxContent = sections.length > 0 ? Math.min(sections.length, maxContentCards) : 0;

  const cards: Card[] = [];
  const cover: Card = { type: 'cover', eyebrow: 'BLOG', main_title: stripMarkup(title) };
  const firstSection = sections[0];
  if (firstSection) cover.sub_title = truncate(firstSection.heading, 30);
  cards.push(cover);

  const usedSections = sections.slice(0, maxContent);
  usedSections.forEach((section, idx) => {
    const lead = section.sentences[0] ?? '';
    const bodyText = section.sentences.slice(1, 3).join(' ') || lead;
    cards.push({
      type: 'content',
      section_label: `POINT ${String(idx + 1).padStart(2, '0')}`,
      heading: stripMarkup(section.heading),
      lead: truncate(lead, 60),
      body_text: truncate(bodyText, 140),
    });
  });

  if (keywords.length > 0) {
    cards.push({
      type: 'list',
      section_label: 'SUMMARY',
      heading: stripMarkup('핵심 키워드 정리'),
      items: keywords.slice(0, 5).map((k) => truncate(k, 24)),
    });
  }

  cards.push({ type: 'closing', message: stripMarkup('자세한 내용은 블로그에서 확인하세요'), cta: '블로그 링크를 확인해주세요' });
  return { cards, usedSections };
}

// ───────── AI로 문구 다듬기 ─────────

export interface RewriteItem {
  index: number;
  heading: string;
  source: string;
}

/** AI에게 보낼 덩어리 목록. 내용 카드마다 소제목과 원문을 싣는다 */
export function rewritePayload(cards: Card[], sections: ParsedSection[]): RewriteItem[] {
  const items: RewriteItem[] = [];
  for (const card of cards) {
    if (card.type !== 'content') continue;
    const section = sections[items.length];
    if (!section) break;
    items.push({ index: items.length + 1, heading: card.heading, source: section.sentences.join(' ').slice(0, 600) });
  }
  return items;
}

/** 다듬기 프롬프트. 프롬프트 글은 묶음에서 받는다. 묶음에 없으면 null (예전 묶음) */
export function buildRewritePrompt(pack: PromptPack, title: string, payload: RewriteItem[]): string | null {
  const template = pack.glue['cards.rewrite'];
  if (typeof template !== 'string' || payload.length === 0) return null;
  const total = payload.length;
  return fill(template, {
    title,
    total,
    indexes: Array.from({ length: total }, (_, i) => i + 1).join(', '),
    payload: JSON.stringify(payload, null, 2),
    examples: Array.from({ length: total }, (_, i) => `{"index": ${i + 1}, "lead": "...", "body_text": "..."}`).join(',\n    '),
  });
}

export type Rewrites = Map<number, { lead?: string; body_text?: string }>;

/** AI의 답에서 카드별 문구를 꺼낸다. 알아보지 못하면 null */
export function parseRewrites(raw: string): Rewrites | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { cards?: Array<{ index: number; lead?: string; body_text?: string }> };
    const map: Rewrites = new Map();
    for (const item of data.cards ?? []) if (typeof item.index === 'number') map.set(item.index, item);
    return map;
  } catch {
    return null;
  }
}

/** 빠진 번호가 있으면 한 번 더 물어야 한다 */
export function missingRewrites(rewrites: Rewrites, total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1).filter((i) => !rewrites.has(i));
}

/** 다듬은 문구를 내용 카드에 넣는다. 카드는 새로 만들어 돌려준다 */
export function applyRewrites(cards: Card[], rewrites: Rewrites): Card[] {
  let n = 0;
  return cards.map((card) => {
    if (card.type !== 'content') return card;
    n += 1;
    const rewrite = rewrites.get(n);
    if (!rewrite) return card;
    return {
      ...card,
      lead: rewrite.lead?.trim() ? rewrite.lead.trim() : card.lead,
      body_text: rewrite.body_text?.trim() ? rewrite.body_text.trim() : card.body_text,
    };
  });
}

// ───────── 블로그용 ─────────

/**
 * 블로그 글 안에 넣을 카드만 고른다: 표지와 내용 카드.
 * 키워드 정리 카드와 마무리 카드("블로그에서 확인하세요")는 카드뉴스용이라 글 안에서는 뺀다.
 * 소제목이 없는 글은 표지만 남긴다 (문단마다 카드를 넣으면 글이 카드로 뒤덮인다).
 */
export function blogCards(built: BuiltCards, shape: BodyShape, includeCover: boolean): Card[] {
  return built.cards
    .filter((card) => {
      if (card.type === 'cover') return includeCover;
      if (card.type === 'content') return shape !== 'paragraphs';
      return false;
    })
    // 소제목 아래에 문장이 하나뿐이면 핵심 문장과 설명이 같은 문장이 된다.
    // 카드에 같은 말이 두 번 찍히지 않게 설명을 비운다.
    .map((card) => (card.type === 'content' && card.body_text.trim() === card.lead.trim() ? { ...card, body_text: '' } : card));
}

/** 글에서 숫자만 뽑는다. 쉼표는 뗀다 ("5,000" → "5000") */
const numberTokens = (text: string): string[] => text.match(/\d+(?:,\d+)*(?:\.\d+)?/g) ?? [];
const plainNumber = (found: string): string => found.replace(/,/g, '');

/**
 * 제목과 본문에 있는 숫자들 (쉼표를 뗀 모양). 카드에서 이 숫자들만 눈에 띄게 한다.
 * 본문의 꾸밈 표시([h2] 같은 것)와 이미지 자리에 든 숫자는 치지 않는다.
 */
export function knownNumbers(title: string, body: string): Set<string> {
  const source = `${title}\n${body}`.replace(/\[IMG:[^\]]*\]/g, ' ').replace(/\[\/?[a-z][a-z0-9]*\]/gi, ' ');
  return new Set(numberTokens(source).map(plainNumber));
}

/**
 * 카드 글에 있는데 본문에는 없는 숫자를 찾는다. 카드의 숫자가 본문과 다르면 안 되기 때문이다.
 * 숫자를 통째로 견준다. 본문에 "5,000만"이 있다고 카드의 "50%"나 "5억"을 넘어가지 않는다.
 * 본문의 꾸밈 표시([h2] 같은 것)와 이미지 자리에 든 숫자는 본문의 숫자로 치지 않는다.
 */
export function numbersNotInBody(card: Card, title: string, body: string): string[] {
  const text =
    card.type === 'cover' ? `${card.main_title} ${card.sub_title ?? ''}`
    : card.type === 'content' ? `${card.heading} ${card.lead} ${card.body_text}`
    : card.type === 'list' ? `${card.heading} ${card.items.join(' ')}`
    : `${card.message} ${card.cta}`;
  const known = knownNumbers(title, body);
  const missing: string[] = [];
  for (const found of numberTokens(text)) {
    if (!known.has(plainNumber(found)) && !missing.includes(found)) missing.push(found);
  }
  return missing;
}
