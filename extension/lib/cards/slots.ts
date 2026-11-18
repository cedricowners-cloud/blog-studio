// 카드를 넣을 자리를 본문에 만든다. 자리는 "[IMG: 카드N - 설명]" 줄이다.
//   카드0  표지. 글 맨 위에 둔다
//   카드N  N번째 내용 카드. 그 카드의 소제목 줄 바로 아래에 둔다
// 다시 만들 때는 예전에 넣은 카드 자리를 먼저 지운다. 사람이 넣은 다른 사진 자리는 건드리지 않는다.

/** 자리를 만들 카드. 내용 카드는 본문의 어느 소제목 아래에 둘지(anchor)를 같이 준다 */
export type SlotCard = { kind: 'cover'; alt: string } | { kind: 'content'; anchor: string; alt: string };

const CARD_SLOT_LINE = /^\[IMG:\s*카드\d+(\s-\s[^\]]*)?\]\s*$/;

export const cardSlotName = (order: number): string => `카드${order}`;
export const isCardSlotName = (name: string): boolean => /^카드\d+$/.test(name);

/** 자리 줄에 넣을 설명. 대괄호가 있으면 자리 줄이 깨지므로 뺀다 */
const safeAlt = (text: string): string => text.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** 소제목 줄이면 그 글자를, 아니면 null 을 돌려준다. 카드의 소제목과 같은 방식으로 다듬는다 */
export function headingOf(line: string): string | null {
  const markup = /^\s*\[h2\]([\s\S]*?)\[\/h2\]\s*$/.exec(line);
  if (markup) return (markup[1] ?? '').replace(/\[\/?[a-z0-9]+\]/gi, '').replace(/\s+/g, ' ').trim();
  const markdown = /^(#{1,3})\s+(.+)$/.exec(line);
  if (markdown) return (markdown[2] ?? '').replace(/\*\*/g, '').trim();
  return null;
}

/** 소제목이 같은지 견줄 때 쓰는 모양: 꾸밈 표시와 빈칸의 차이를 없앤다 */
const sameHeading = (text: string): string => text.replace(/\[\/?[a-z0-9_]+[^\]]*\]/gi, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

export interface SlottedBody {
  body: string;
  /** 받은 카드와 같은 순서. 자리를 만들었으면 자리 이름, 본문에서 소제목을 찾지 못했으면 null */
  names: (string | null)[];
}

/** 본문에 카드 자리를 만들어 넣는다. */
export function applyCardSlots(body: string, cards: SlotCard[]): SlottedBody {
  const lines = body.split('\n').filter((line) => !CARD_SLOT_LINE.test(line.trim()));
  const names: (string | null)[] = cards.map(() => null);
  const out: string[] = [];

  const coverIndex = cards.findIndex((card) => card.kind === 'cover');
  const cover = cards[coverIndex];
  if (cover) {
    names[coverIndex] = cardSlotName(0);
    out.push(`[IMG: ${cardSlotName(0)} - ${safeAlt(cover.alt) || '표지'}]`);
  }

  // 내용 카드는 순서대로, 같은 소제목을 가진 줄 아래에 둔다.
  const contents = cards.map((card, index) => ({ card, index })).filter((item) => item.card.kind === 'content');
  let next = 0;
  for (const line of lines) {
    out.push(line);
    const item = contents[next];
    if (!item || item.card.kind !== 'content') continue;
    const heading = headingOf(line);
    if (heading === null || sameHeading(heading) !== sameHeading(item.card.anchor)) continue;
    const name = cardSlotName(next + 1);
    names[item.index] = name;
    out.push(`[IMG: ${name} - ${safeAlt(item.card.alt) || '카드'}]`);
    next += 1;
  }

  return { body: out.join('\n'), names };
}

/**
 * 본문에서 이미지 자리를 뺀 글. 카드의 문구를 만들 때는 이 글을 쓴다.
 * 이미지 자리는 글이 아니라 표시라서, 카드의 문장에 들어가면 안 된다
 * (카드를 글에 넣은 뒤 카드를 다시 만들 때 "[IMG: 카드1 - …]"이 카드에 찍히던 문제).
 * 본문 자체는 바꾸지 않는다.
 */
export function withoutImageSlots(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*\[IMG:[^\]]*\]\s*$/.test(line))
    .join('\n')
    .replace(/\[IMG:[^\]]*\]/g, '');
}
