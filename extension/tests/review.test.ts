// 사진으로 리뷰 쓰기: 프롬프트 조립, AI의 답 읽기, 사진 자리 정리.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangePhotos, buildReviewPrompt, canReview, countUnsure, parseReview, photoSlotName } from '../lib/review/photo.ts';
import { parseMarkup } from '../lib/blocks/parse-markup.ts';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const pack = await buildPack();

test('사진 리뷰: 프롬프트에 제품, 메모, 구매 방식, 사진 수가 들어간다', () => {
  assert.equal(canReview(pack), true);
  const built = buildReviewPrompt(pack, { product: ' 가나다 도킹스테이션 ', notes: '5만 9천 원. 열이 덜 나서 좋았음.', purchase: 'own', photoCount: 3, voiceCard: null });
  assert.ok(built);
  assert.ok(built.prompt.includes('가나다 도킹스테이션'));
  assert.ok(built.prompt.includes('5만 9천 원. 열이 덜 나서 좋았음.'));
  assert.ok(built.prompt.includes('사진 3장'));
  assert.ok(built.prompt.includes(pack.glue['review.purchase_own'] as string));
  assert.ok(!built.prompt.includes('{{'), '채우지 못한 자리가 남았어요');
  assert.ok(!built.prompt.includes('[내 말투]'));
  assert.deepEqual(built.labels, ['사진 1', '사진 2', '사진 3']);
});

test('사진 리뷰: 메모가 없으면 없다고 알려 주고, 말투 카드가 있으면 붙인다', () => {
  const built = buildReviewPrompt(pack, { product: '제품', notes: '   ', purchase: 'sponsored', photoCount: 1, voiceCard: '- 문장 끝은 ~해요로 맺어요.' });
  assert.ok(built);
  assert.ok(built.prompt.includes(pack.glue['review.no_notes'] as string));
  assert.ok(built.prompt.includes(pack.glue['review.purchase_sponsored'] as string));
  assert.ok(built.prompt.includes('[내 말투]'));
  assert.ok(built.prompt.includes('- 문장 끝은 ~해요로 맺어요.'));
  // 말투는 출력 형식보다 앞에 온다. 형식 안내가 맨 끝이어야 AI가 형식을 지킨다.
  assert.ok(built.prompt.indexOf('[내 말투]') < built.prompt.lastIndexOf('[본문]'));
});

test('사진 리뷰: 메모에 적은 {{…}} 글자를 다시 바꾸지 않는다', () => {
  const built = buildReviewPrompt(pack, { product: '제품 {{voice}}', notes: '{{purchase}} 라고 적음', purchase: 'none', photoCount: 1, voiceCard: null });
  assert.ok(built);
  assert.ok(built.prompt.includes('제품 {{voice}}'));
  assert.ok(built.prompt.includes('{{purchase}} 라고 적음'));
});

test('사진 리뷰: 예전 묶음에는 프롬프트가 없어서 만들지 않는다', () => {
  const old = JSON.parse(JSON.stringify(pack));
  delete old.glue['review.photo'];
  assert.equal(canReview(old), false);
  assert.equal(buildReviewPrompt(old, { product: '제품', notes: '', purchase: 'own', photoCount: 1, voiceCard: null }), null);
});

test('사진 리뷰: AI의 답에서 제목 후보와 본문을 꺼낸다', () => {
  const parsed = parseReview('[제목]\n1. 첫 제목\n- **둘째 제목**\n제목 후보 3: "셋째 제목"\n\n[본문]\n[h2]소제목[/h2]\n문단입니다.\n');
  assert.deepEqual(parsed, { titles: ['첫 제목', '둘째 제목', '셋째 제목'], body: '[h2]소제목[/h2]\n문단입니다.' });
  // 코드 표시로 감싸도 읽는다
  assert.deepEqual(parseReview('```\n[제목]\n제목\n[본문]\n본문\n```'), { titles: ['제목'], body: '본문' });
  // 표시가 없으면 첫 줄을 제목으로 본다
  assert.deepEqual(parseReview('그냥 제목\n\n본문 한 줄'), { titles: ['그냥 제목'], body: '본문 한 줄' });
  // 본문이 없으면 읽지 못한 것이다
  assert.equal(parseReview('[제목]\n제목만\n[본문]\n'), null);
  assert.equal(parseReview(''), null);
});

test('사진 리뷰: 사진 자리를 정리한다 (없는 번호와 겹친 번호는 지우고, 빠진 사진은 끝에 붙인다)', () => {
  const body = [
    '도입입니다. [IMG: 사진2 - 상자 겉모습] 이어지는 글.',
    '[IMG:사진 1-전체 모습]',
    '[IMG: 사진2 - 또 쓴 2번]',
    '[IMG: 사진9 - 없는 번호]',
    '[IMG: 제품 광고 사진]',
    '마무리입니다.',
  ].join('\n');
  const plan = arrangePhotos(body, 4);
  assert.deepEqual(plan.placed, [1, 2]);
  assert.deepEqual(plan.appended, [3, 4]);
  assert.equal(plan.dropped, 3);
  assert.deepEqual(plan.body.split('\n').filter((line) => line.trim()), [
    '도입입니다.',
    '[IMG: 사진2 - 상자 겉모습]',
    ' 이어지는 글.',
    '[IMG: 사진1 - 전체 모습]',
    '마무리입니다.',
    '[IMG: 사진3]',
    '[IMG: 사진4]',
  ]);
  assert.ok(!/\n{3,}/.test(plan.body));

  // 정리한 본문의 사진 자리는 채우기 화면이 읽는 모양이다: 자리 이름이 "사진N" 이다
  const slots = parseMarkup(plan.body).blocks.flatMap((block) => (block.kind === 'image' ? [block.slot] : []));
  assert.deepEqual(slots, [photoSlotName(2), photoSlotName(1), photoSlotName(3), photoSlotName(4)]);
});

test('사진 리뷰: 사진을 모두 제자리에 쓴 글은 그대로 둔다', () => {
  const body = '[IMG: 사진1 - 전체]\n\n문단입니다.\n\n[IMG: 사진2 - 옆모습]';
  assert.deepEqual(arrangePhotos(body, 2), { body, placed: [1, 2], appended: [], dropped: 0 });
});

test('사진 리뷰: 확인 필요 표시를 센다', () => {
  assert.equal(countUnsure('가격은 (확인 필요: 실제 가격) 이고 무게는 (확인필요: 무게) 입니다.'), 2);
  assert.equal(countUnsure('확인할 것이 없는 글'), 0);
});
