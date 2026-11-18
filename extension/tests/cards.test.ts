// 블로그용 카드: 카드 자리를 본문에 넣기, 블로그에 쓸 카드 고르기, 숫자 확인, 글 줄바꿈을 시험한다.
// (카드 내용이 웹과 같은지는 tests/parity.test.ts 가 확인한다.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkup } from '../lib/blocks/parse-markup.ts';
import { blogCards, bodyShape, buildCards, knownNumbers, numbersNotInBody, type Card } from '../lib/cards/parser.ts';
import { CARD_DESIGNS, cardStyle, isCardDesign, mixColor, sectionNumber, splitNumbers, wrapText } from '../lib/cards/render.ts';
import { applyCardSlots, cardSlotName, headingOf, isCardSlotName, withoutImageSlots, type SlotCard } from '../lib/cards/slots.ts';

const MARKUP = '도입 문단입니다.\n[h2]가업 승계란[/h2]\n가업을 물려주는 일입니다. 세금이 문제입니다.\n[IMG: 사진 - 내가 넣은 자리]\n[h2][bold]증여세[/bold]  계산[/h2]\n공제는 10년 동안 5천만 원입니다.';
const cover: SlotCard = { kind: 'cover', alt: '가업 승계 [준비]' };
const content = (anchor: string): SlotCard => ({ kind: 'content', anchor, alt: anchor });

test('카드 자리: 표지는 맨 위에, 내용 카드는 소제목 바로 아래에 둔다', () => {
  const result = applyCardSlots(MARKUP, [cover, content('가업 승계란'), content('증여세 계산')]);
  assert.deepEqual(result.names, ['카드0', '카드1', '카드2']);
  assert.deepEqual(result.body.split('\n'), [
    '[IMG: 카드0 - 가업 승계 준비]',
    '도입 문단입니다.',
    '[h2]가업 승계란[/h2]',
    '[IMG: 카드1 - 가업 승계란]',
    '가업을 물려주는 일입니다. 세금이 문제입니다.',
    '[IMG: 사진 - 내가 넣은 자리]',
    '[h2][bold]증여세[/bold]  계산[/h2]',
    '[IMG: 카드2 - 증여세 계산]',
    '공제는 10년 동안 5천만 원입니다.',
  ]);
  // 채우기가 읽는 사진 자리와도 맞는다
  const slots = parseMarkup(result.body).blocks.flatMap((b) => (b.kind === 'image' ? [b.slot] : []));
  assert.deepEqual(slots, ['카드0', '카드1', '사진', '카드2']);
  assert.deepEqual(slots.map(isCardSlotName), [true, true, false, true]);
});

test('카드 자리: 다시 넣으면 예전 카드 자리를 지우고 새로 만든다 (다른 사진 자리는 그대로)', () => {
  const once = applyCardSlots(MARKUP, [cover, content('가업 승계란'), content('증여세 계산')]);
  // 이번에는 표지 없이, 둘째 소제목의 카드만 넣는다
  const twice = applyCardSlots(once.body, [content('증여세 계산')]);
  assert.deepEqual(twice.names, ['카드1']);
  assert.equal(twice.body.split('\n').filter((line) => /카드\d/.test(line)).length, 1);
  assert.ok(twice.body.includes('[IMG: 사진 - 내가 넣은 자리]'));
  assert.ok(twice.body.includes('[h2][bold]증여세[/bold]  계산[/h2]\n[IMG: 카드1 - 증여세 계산]'));
  // 아무 카드도 없으면 카드 자리만 사라진다
  assert.equal(applyCardSlots(once.body, []).body, MARKUP);
});

test('카드 자리: 본문에서 소제목을 찾지 못한 카드는 자리를 만들지 않고 알려 준다', () => {
  const result = applyCardSlots(MARKUP, [content('가업 승계란'), content('본문에 없는 소제목'), content('증여세 계산')]);
  // 순서대로 짝짓기 때문에, 못 찾은 카드 뒤의 카드도 자리를 얻지 못한다
  assert.deepEqual(result.names, ['카드1', null, null]);
  assert.equal(result.body.split('\n').filter((line) => /카드\d/.test(line)).length, 1);
});

test('카드 자리: 마크다운 소제목도 알아본다', () => {
  const md = '# 법인 전환\n\n설명입니다.\n\n## 언제 **해야** 하나요?\n\n답입니다.\n\n### 비용';
  const result = applyCardSlots(md, [cover, content('법인 전환'), content('언제 해야 하나요?'), content('비용')]);
  assert.deepEqual(result.names, ['카드0', '카드1', '카드2', '카드3']);
  assert.ok(result.body.includes('## 언제 **해야** 하나요?\n[IMG: 카드2 - 언제 해야 하나요?]'));
  assert.equal(headingOf('## 제목'), '제목');
  assert.equal(headingOf('[h2]제목[/h2]'), '제목');
  assert.equal(headingOf('그냥 문단'), null);
  assert.equal(headingOf('#붙여 쓴 것은 소제목이 아님'), null);
  assert.equal(cardSlotName(3), '카드3');
});

test('블로그용 카드: 표지와 소제목 카드만 쓰고, 소제목이 없는 글은 표지만 쓴다', () => {
  const built = buildCards({ title: '가업 승계 준비', body: MARKUP, keywords: ['가업 승계'] });
  assert.deepEqual(built.cards.map((c) => c.type), ['cover', 'content', 'content', 'list', 'closing']);
  assert.deepEqual(blogCards(built, bodyShape(MARKUP), true).map((c) => c.type), ['cover', 'content', 'content']);
  assert.deepEqual(blogCards(built, bodyShape(MARKUP), false).map((c) => c.type), ['content', 'content']);

  const plain = '첫 문단입니다.\n\n둘째 문단입니다.';
  assert.equal(bodyShape(plain), 'paragraphs');
  assert.deepEqual(blogCards(buildCards({ title: '제목', body: plain }), 'paragraphs', true).map((c) => c.type), ['cover']);
  assert.equal(bodyShape('## 소제목\n글'), 'markdown');
  assert.equal(bodyShape(MARKUP), 'markup');
});

test('블로그용 카드: 이미지 자리는 카드의 글에 들어가지 않는다 (카드를 넣은 뒤 다시 만들어도 같다)', () => {
  assert.equal(withoutImageSlots('글 [IMG: 가 - 나] 끝\n[IMG: 카드1 - 소제목]\n  [IMG: 사진]  \n다음 줄'), '글  끝\n다음 줄');
  const clean = withoutImageSlots(MARKUP);
  assert.ok(!clean.includes('[IMG'));
  // 카드 자리가 들어간 본문으로 다시 만들어도, 처음 만든 카드와 같다
  const slotted = applyCardSlots(MARKUP, [cover, content('가업 승계란'), content('증여세 계산')]).body;
  assert.ok(slotted.includes('[IMG: 카드1'));
  const again = buildCards({ title: '제목', body: withoutImageSlots(slotted) });
  assert.deepEqual(again, buildCards({ title: '제목', body: clean }));
  assert.ok(!JSON.stringify(again.cards).includes('IMG'));
});

test('블로그용 카드: 핵심 문장과 설명이 같으면 설명을 비운다 (같은 말이 두 번 찍히지 않게)', () => {
  const body = '[h2]하나뿐인 문장[/h2]\n문장이 하나뿐입니다.\n[h2]문장이 둘[/h2]\n첫 문장입니다. 둘째 문장입니다.';
  const cards = blogCards(buildCards({ title: '제목', body }), 'markup', false);
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.type, 'content');
    if (card.type === 'content') assert.notEqual(card.body_text.trim(), card.lead.trim());
  }
  const texts = cards.map((card) => (card.type === 'content' ? card.body_text : null));
  assert.equal(texts[0], '');
  assert.ok((texts[1] ?? '').length > 0);
});

test('블로그용 카드: 카드에 있는데 본문에 없는 숫자를 찾는다', () => {
  const body = '공제는 10년 동안 5,000만 원입니다. 세율은 10%에서 50%까지입니다.';
  const card = (lead: string): Card => ({ type: 'content', section_label: 'POINT 01', heading: '증여세', lead, body_text: '' });
  assert.deepEqual(numbersNotInBody(card('10년 동안 5000만 원을 공제합니다.'), '제목', body), []);
  assert.deepEqual(numbersNotInBody(card('공제는 3억 원이고 세율은 50%입니다.'), '제목', body), ['3']);
  assert.deepEqual(numbersNotInBody(card('15년 동안 6,000만 원, 그리고 6,000만 원'), '제목', body), ['15', '6,000']);
  // 숫자를 통째로 견준다: 본문의 "5,000"이나 "10"에 들어 있는 글자라고 넘어가지 않는다
  assert.deepEqual(numbersNotInBody(card('공제는 5억 원, 세율은 1%부터입니다.'), '제목', body), ['5', '1']);
  // 본문의 꾸밈 표시와 이미지 자리에 든 숫자는 본문의 숫자가 아니다
  assert.deepEqual(numbersNotInBody(card('핵심은 2가지, 그리고 7번입니다.'), '제목', '[h2]소제목[/h2]\n[IMG: 카드7 - 그림]\n글입니다.'), ['2', '7']);
  // 소수와 쉼표
  assert.deepEqual(numbersNotInBody(card('금리는 3.5%, 한도는 1,000만 원, 그리고 10, 20'), '제목', '금리 3.5% 한도 1000만 원. 10 과 20'), []);
  // 번호표(POINT 01)의 숫자는 보지 않는다. 제목에 있는 숫자는 괜찮다
  assert.deepEqual(numbersNotInBody({ type: 'cover', eyebrow: 'BLOG', main_title: '2026 증여세 정리' }, '2026 증여세 정리', body), []);
});

test('카드 그리기: 글을 너비에 맞게 줄바꿈한다 (낱말 가운데에서 자르지 않는다)', () => {
  const measure = (text: string) => text.length * 10; // 글자 하나가 10
  assert.deepEqual(wrapText(measure, '가업 승계는 미리 준비해야 합니다', 80), ['가업 승계는', '미리 준비해야', '합니다']);
  assert.deepEqual(wrapText(measure, '가업 승계는 미리 준비해야 합니다', 60), ['가업 승계는', '미리', '준비해야', '합니다']);
  assert.deepEqual(wrapText(measure, '가업 승계는 미리 준비해야 합니다', 120), ['가업 승계는 미리', '준비해야 합니다']);
  // 낱말 하나가 너비보다 길면 그 낱말만 글자 단위로 나눈다
  assert.deepEqual(wrapText(measure, '짧은 아주아주아주긴낱말입니다 끝', 50), ['짧은', '아주아주아', '주긴낱말입', '니다 끝']);
  // 줄바꿈 글자는 지키고, 빈 글은 빈 줄 하나다
  assert.deepEqual(wrapText(measure, '첫 줄\n\n셋째 줄', 100), ['첫 줄', '', '셋째 줄']);
  assert.deepEqual(wrapText(measure, '', 100), ['']);
  assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColor('#1e3a8a', '#ffffff', 0), '#1e3a8a');
});

test('카드 모양: 여덟 가지가 있고, 모르는 이름은 받지 않는다', () => {
  assert.deepEqual(Object.keys(CARD_DESIGNS).sort(), ['band', 'classic', 'dark', 'magazine', 'note', 'quote', 'side', 'soft']);
  for (const design of Object.keys(CARD_DESIGNS)) assert.ok(isCardDesign(design));
  for (const bad of ['', 'x', 'toString', 'constructor', null, undefined, 3]) assert.equal(isCardDesign(bad), false);
  assert.equal(cardStyle('wide', '#1e3a8a', ' 가나다 ', 'dark').design, 'dark');
  assert.equal(cardStyle('wide', '#1e3a8a', ' 가나다 ', 'dark').brandName, '가나다');
  // 모양을 말하지 않으면 예전과 같은 기본 모양이다
  assert.equal(cardStyle('square', '#1e3a8a', '').design, 'classic');
});

test('카드 그리기: 숫자와 바로 붙은 단위를 찾아 눈에 띄게 한다', () => {
  const strong = (line: string, known: Set<string> | null = null) => splitNumbers(line, known).filter((s) => s.strong).map((s) => s.text);
  const line = '성인 자녀는 10년 동안 5,000만 원까지 공제됩니다.';
  assert.deepEqual(splitNumbers(line, null), [
    { text: '성인 자녀는 ', strong: false },
    { text: '10년', strong: true },
    { text: ' 동안 ', strong: false },
    { text: '5,000만 원', strong: true },
    { text: '까지 공제됩니다.', strong: false },
  ]);
  assert.deepEqual(strong('금리는 3.5%입니다. 2026년 1월 1일부터 3억 5천만 원.'), ['3.5%', '2026년', '1월', '1일', '3억', '5천만 원']);
  // 나눈 조각을 이으면 원래 글이다 (글자가 빠지거나 겹치지 않는다)
  for (const sample of [line, '숫자가 없는 글', '끝이 숫자 10', '10', '1,000.5원 그리고 20.']) {
    assert.equal(splitNumbers(sample, null).map((s) => s.text).join(''), sample);
  }
  assert.deepEqual(splitNumbers('숫자가 없는 글', null), [{ text: '숫자가 없는 글', strong: false }]);
  // 문장 끝의 마침표는 숫자에 넣지 않는다
  assert.deepEqual(strong('모두 20.'), ['20']);
});

test('카드 그리기: 본문에 있는 숫자만 눈에 띄게 한다', () => {
  const known = knownNumbers('2026 증여세 정리', '[h2]공제[/h2]\n10년 동안 5,000만 원입니다.\n[IMG: 카드7 - 그림]');
  assert.deepEqual([...known].sort(), ['10', '2026', '5000']);
  const strong = splitNumbers('10년 동안 5000만 원, 세율은 50%, 카드 7번, 소제목 2개', known).filter((s) => s.strong).map((s) => s.text);
  assert.deepEqual(strong, ['10년', '5000만 원']);
});

test('카드 그리기: 번호표에서 번호를 꺼낸다', () => {
  assert.equal(sectionNumber('POINT 01'), '01');
  assert.equal(sectionNumber(' POINT 12 '), '12');
  assert.equal(sectionNumber('SUMMARY'), '');
});
