// 사진으로 리뷰 글 쓰기: 프롬프트 조립, AI의 답 읽기, 사진 자리 정리. 값만 다루고 화면은 건드리지 않는다.
// 프롬프트 글은 묶음에서 받는다 (review.* 조각). 여기에는 적지 않는다.
import { fill, glue, type PromptPack } from '../prompts/pack.ts';

export type Purchase = 'own' | 'sponsored' | 'none';

export const PURCHASES: Purchase[] = ['own', 'sponsored', 'none'];

/** 한 번에 보낼 수 있는 사진 수. 많이 보내면 느려지고 비용이 늘어난다 */
export const MAX_PHOTOS = 10;

export interface ReviewInput {
  product: string;
  notes: string;
  purchase: Purchase;
  photoCount: number;
  /** 내 말투 카드. 없거나 쓰지 않으면 null */
  voiceCard: string | null;
}

export interface ReviewPrompt {
  prompt: string;
  /** 사진마다 바로 앞에 붙여 보내는 이름표 */
  labels: string[];
}

const piece = (pack: PromptPack, key: string): string | null => {
  const value = (pack.glue as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

/** 받아 둔 묶음에 사진 리뷰 프롬프트가 있는지 (예전 묶음에는 없다) */
export function canReview(pack: PromptPack): boolean {
  return ['review.photo', 'review.photo_label', 'review.no_notes', ...PURCHASES.map((p) => `review.purchase_${p}`)].every((key) => piece(pack, key) !== null);
}

/** 프롬프트를 만든다. 묶음에 사진 리뷰 프롬프트가 없으면 null */
export function buildReviewPrompt(pack: PromptPack, input: ReviewInput): ReviewPrompt | null {
  if (!canReview(pack)) return null;
  const card = input.voiceCard?.trim() ?? '';
  return {
    prompt: fill(piece(pack, 'review.photo') as string, {
      product: input.product.trim(),
      notes: input.notes.trim() || (piece(pack, 'review.no_notes') as string),
      purchase: piece(pack, `review.purchase_${input.purchase}`) as string,
      photo_count: input.photoCount,
      voice: card ? fill(glue(pack, 'voice.block'), { card }) : '',
    }),
    labels: Array.from({ length: input.photoCount }, (_, i) => fill(piece(pack, 'review.photo_label') as string, { n: i + 1 })),
  };
}

export interface ParsedReview {
  titles: string[];
  body: string;
}

const cleanTitle = (line: string): string =>
  line
    .replace(/^\s*(?:[-*•]|\d+[.)]|제목\s*(?:후보)?\s*\d*\s*[:：])\s*/, '')
    .replace(/^[\s"'“”‘’*]+|[\s"'“”‘’*]+$/g, '')
    .trim();

/** AI의 답에서 제목 후보와 본문을 꺼낸다. 본문을 찾지 못하면 null */
export function parseReview(raw: string): ParsedReview | null {
  const text = raw
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
  const TITLE = '[제목]';
  const BODY = '[본문]';
  const bodyAt = text.indexOf(BODY);
  let titlePart: string;
  let body: string;
  if (bodyAt >= 0) {
    const titleAt = text.indexOf(TITLE);
    titlePart = titleAt >= 0 && titleAt < bodyAt ? text.slice(titleAt + TITLE.length, bodyAt) : text.slice(0, bodyAt);
    body = text.slice(bodyAt + BODY.length);
  } else {
    // 표시가 없으면 첫 줄을 제목으로 본다.
    const [first = '', ...rest] = text.replace(TITLE, '').trim().split('\n');
    titlePart = first;
    body = rest.join('\n');
  }
  body = body.trim();
  if (!body) return null;
  const titles = titlePart.split('\n').map(cleanTitle).filter(Boolean).slice(0, 5);
  return { titles, body };
}

/** 본문에 적는 사진 자리의 이름 */
export const photoSlotName = (n: number): string => `사진${n}`;

export interface PhotoPlan {
  body: string;
  /** 글 속에 자리를 잡은 사진의 번호 */
  placed: number[];
  /** AI가 글에 넣지 않아서 글 끝에 붙인 사진의 번호 */
  appended: number[];
  /** 지운 자리의 수: 없는 번호, 두 번 쓴 번호, 사진과 상관없는 이미지 자리 */
  dropped: number;
}

/**
 * AI가 쓴 본문의 사진 자리를 정리한다.
 *  - 자리는 한 줄에 하나씩 둔다 ("[IMG: 사진N - 설명]").
 *  - 없는 번호와 두 번째로 나온 번호, 내 사진이 아닌 이미지 자리는 지운다. 넣을 사진이 없기 때문이다.
 *  - AI가 빠뜨린 사진은 버리지 않고 글 끝에 붙인다.
 */
export function arrangePhotos(body: string, photoCount: number): PhotoPlan {
  const seen = new Set<number>();
  let dropped = 0;
  const lines: string[] = [];
  for (const line of body.replace(/\[IMG:[^\]]*\]/g, (slot) => `\n${slot}\n`).split('\n')) {
    const trimmed = line.trim();
    if (!/^\[IMG:[^\]]*\]$/.test(trimmed)) {
      lines.push(line);
      continue;
    }
    const match = /^\[IMG:\s*사진\s*(\d+)\s*(?:[-–:]\s*([^\]]*))?\]$/.exec(trimmed);
    const n = match ? Number(match[1]) : 0;
    if (!match || n < 1 || n > photoCount || seen.has(n)) {
      dropped += 1;
      continue;
    }
    seen.add(n);
    const alt = (match[2] ?? '').trim();
    lines.push(`[IMG: ${photoSlotName(n)}${alt ? ` - ${alt}` : ''}]`);
  }
  const appended: number[] = [];
  for (let n = 1; n <= photoCount; n += 1) {
    if (seen.has(n)) continue;
    appended.push(n);
    lines.push('', `[IMG: ${photoSlotName(n)}]`);
  }
  return {
    body: lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    placed: [...seen].sort((a, b) => a - b),
    appended,
    dropped,
  };
}

/** 본문에 남아 있는 "확인 필요" 표시의 수 */
export const countUnsure = (body: string): number => (body.match(/확인\s?필요/g) ?? []).length;
