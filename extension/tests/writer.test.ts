// 글 만들기의 흐름(만들기 → 검사 → 다시 쓰기)과 SEO 8단계의 진행을 가짜 AI로 시험한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage, LLMResult } from '../lib/llm/client.ts';
import { fill, validatePack } from '../lib/prompts/pack.ts';
import {
  advance,
  createRun,
  extractTitles,
  initialMessageFor,
  pasteResult,
  resetStep,
  resultOf,
  selectTitle,
  sendMessage,
  startStep,
  stepsOf,
} from '../lib/seo/engine.ts';
import { run } from '../lib/writer/retry-loop.ts';
import type { BlogGenerationInput } from '../lib/writer/types.ts';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const pack = await buildPack();

const input: BlogGenerationInput = {
  method_id: 1,
  topic: '가업 승계 준비',
  main_keyword: '가업 승계',
  sub_keywords: ['증여세', '상속세'],
};

const answer = (bodyLength: number, failedNumbers: number[] = []): string =>
  JSON.stringify({
    mapping: {},
    titles: [{ rank: 1, title: '가업 승계 준비 순서' }],
    body: '글'.repeat(bodyLength),
    axiom_check: {
      items: Array.from({ length: 15 }, (_, i) => ({
        number: i + 1,
        rule: `규칙 ${i + 1}`,
        passed: !failedNumbers.includes(i + 1),
        evidence: failedNumbers.includes(i + 1) ? '근거가 모자람' : '있음',
      })),
    },
    suggestions: {},
    meta: {},
  });

const reply = (text: string, stopReason: LLMResult['stopReason'] = 'end'): LLMResult => ({
  text,
  usage: { input_tokens: 100, output_tokens: 200 },
  model: 'fake-model',
  stopReason,
});

test('묶음: 만든 묶음은 형식에 맞고, 틀린 파일은 걸러 낸다', () => {
  assert.equal(validatePack(JSON.parse(JSON.stringify(pack))).ok, true);
  assert.equal(validatePack(null).ok, false);
  assert.equal(validatePack({ format: 99 }).ok, false);
  const broken = JSON.parse(JSON.stringify(pack));
  delete broken.glue.output_format;
  broken.seo.steps = [];
  const check = validatePack(broken);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.errors.length, 2);
});

test('묶음: 자리 채우기는 값 안의 {{ }} 를 다시 바꾸지 않는다', () => {
  assert.equal(fill('{{a}} / {{b}} / {{없는것}}', { a: '{{b}}', b: '$& $1' }), '{{b}} / $& $1 / {{없는것}}');
});

test('글 만들기: 한 번에 통과하면 다시 쓰지 않는다', async () => {
  const prompts: string[] = [];
  const result = await run(pack, input, {
    generate: async (prompt) => {
      prompts.push(prompt);
      return reply(answer(1600));
    },
  });
  assert.equal(prompts.length, 1);
  assert.equal(result.needs_human_review, false);
  assert.equal(result.final_attempt_number, 1);
  assert.equal(result.final.body.length, 1600);
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 200 });
  assert.equal(result.model, 'fake-model');
});

test('글 만들기: 통과하지 못하면 무엇이 모자란지 붙여서 다시 쓰게 한다', async () => {
  const prompts: string[] = [];
  const seen: [number, boolean][] = [];
  const answers = [answer(900, [3]), answer(1700)];
  const result = await run(pack, input, {
    generate: async (prompt) => {
      prompts.push(prompt);
      return reply(answers.shift() as string);
    },
    onAttempt: (record, willRetry) => seen.push([record.attempt, willRetry]),
  });
  assert.equal(prompts.length, 2);
  assert.ok((prompts[1] as string).startsWith(prompts[0] as string), '다시 쓰기 요청은 처음 프롬프트 뒤에 붙는다');
  assert.ok((prompts[1] as string).includes('규칙 3'));
  assert.ok((prompts[1] as string).includes('900'));
  assert.deepEqual(seen, [[1, true], [2, false]]);
  assert.equal(result.needs_human_review, false);
  assert.equal(result.final_attempt_number, 2);
  assert.deepEqual(result.usage, { input_tokens: 200, output_tokens: 400 });
});

test('글 만들기: 끝까지 통과하지 못하면 가장 나은 것을 주고 표시해 둔다', async () => {
  const answers = [answer(1600, [1, 2, 3]), answer(1600, [1]), answer(1600, [1, 2])];
  const result = await run(pack, input, { generate: async () => reply(answers.shift() as string) });
  assert.equal(result.attempts.length, 3);
  assert.equal(result.needs_human_review, true);
  assert.equal(result.final_attempt_number, 2);
  assert.equal(result.final_axiom.failed, 1);
});

test('글 만들기: 답이 잘렸으면 기록해 둔다', async () => {
  const result = await run(
    pack,
    { ...input, generation_options: { max_retries: 0 } },
    { generate: async () => reply('{"mapping": {}, "titles": [', 'length') },
  );
  assert.equal(result.attempts[0]?.truncated, true);
  assert.equal(result.final.parse_ok, false);
  assert.equal(result.needs_human_review, true);
});

test('글 만들기: AI 호출이 실패하면 그대로 알린다', async () => {
  await assert.rejects(() => run(pack, input, { generate: async () => Promise.reject(new Error('키가 틀림')) }), /키가 틀림/);
});

// ───────────── SEO 8단계 ─────────────

const NOW = '2026-11-16T10:00:00.000Z';

const newRun = (over: Partial<Parameters<typeof createRun>[0]> = {}) =>
  createRun({
    id: 'run-1',
    platform: 'naver_blog',
    mode: 'api',
    main_keyword: ' 법인 전환 ',
    llm_provider: 'gemini',
    include_optional: true,
    now: NOW,
    ...over,
  });

test('SEO: 블로그는 7단계, 자체 도메인은 8단계다 (URL 단계가 더 있다)', () => {
  assert.deepEqual(stepsOf(pack, newRun()).map((s) => s.id), [1, 2, 3, 4, 5, 6, 8]);
  assert.deepEqual(stepsOf(pack, newRun({ platform: 'custom_domain' })).map((s) => s.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(stepsOf(pack, newRun({ include_optional: false })).map((s) => s.id), [1, 2, 3, 4, 5, 6]);
  assert.throws(() => newRun({ main_keyword: '  ' }));
  assert.equal(newRun().main_keyword, '법인 전환');
});

test('SEO: 처음부터 끝까지 진행한다', async () => {
  const sent: ChatMessage[][] = [];
  let n = 0;
  const chat = async (messages: ChatMessage[]) => {
    sent.push(messages.map((m) => ({ ...m })));
    n += 1;
    return `AI 답 ${n}`;
  };

  let current = newRun();

  // 1단계: 묻지 않는 단계. 답이 곧 결과다.
  current = await startStep(pack, current, 1, chat, NOW);
  assert.equal(resultOf(current, 1).final_output, 'AI 답 1');
  assert.ok((sent[0]?.[0]?.content ?? '').includes('법인 전환'));
  assert.ok(!(sent[0]?.[0]?.content ?? '').includes('{{main_keyword}}'));
  await assert.rejects(() => startStep(pack, current, 1, chat, NOW), /이미 시작/);
  current = advance(pack, current, 1, NOW);
  assert.equal(current.current_step_index, 1);

  // 2단계: AI가 묻고 사람이 답하는 단계. 앞 단계의 결과가 앞에 붙는다.
  current = await startStep(pack, current, 2, chat, NOW);
  assert.ok((sent[1]?.[0]?.content ?? '').includes('AI 답 1'));
  assert.equal(resultOf(current, 2).final_output, null);
  current = await sendMessage(pack, current, 2, ' 삭제해줘 ', chat, NOW);
  assert.deepEqual(sent[2]?.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(sent[2]?.[2]?.content, '삭제해줘');
  assert.equal(resultOf(current, 2).conversation.length, 4);
  current = advance(pack, current, 2, NOW);
  assert.equal(resultOf(current, 2).final_output, 'AI 답 3');
  assert.equal(resultOf(current, 2).completed_at, NOW);

  // 나머지 단계
  for (const step of stepsOf(pack, current).slice(2)) {
    current = await startStep(pack, current, step.id, chat, NOW);
    current = advance(pack, current, step.id, NOW);
  }
  assert.equal(current.status, 'completed');
  assert.equal(current.current_step_index, stepsOf(pack, current).length - 1);
});

test('SEO: AI 호출이 실패하면 진행 상황이 바뀌지 않는다', async () => {
  const fail = async () => Promise.reject(new Error('연결 끊김'));
  const before = newRun();
  await assert.rejects(() => startStep(pack, before, 1, fail, NOW), /연결 끊김/);
  assert.deepEqual(before.results, {});

  const started = await startStep(pack, before, 1, async () => '답', NOW);
  await assert.rejects(() => sendMessage(pack, started, 1, '추가 질문', fail, NOW), /연결 끊김/);
  assert.equal(resultOf(started, 1).conversation.length, 2);
  await assert.rejects(() => sendMessage(pack, started, 1, '   ', async () => '답', NOW), /적어 주세요/);
  await assert.rejects(() => sendMessage(pack, before, 1, '시작 전', async () => '답', NOW), /시작해 주세요/);
});

test('SEO: 결과가 없으면 다음 단계로 넘어가지 못한다', async () => {
  const fresh = newRun();
  assert.throws(() => advance(pack, fresh, 1, NOW), /비어 있어서/);
  // 2단계는 1단계 결과가 있어야 시작된다
  await assert.rejects(() => startStep(pack, fresh, 2, async () => '답', NOW), /앞 단계의 결과/);
});

test('SEO: 복사 방식은 프롬프트를 보여 주고 결과를 붙여넣게 한다', async () => {
  let current = newRun({ mode: 'copy' });
  assert.equal(current.llm_provider, null);
  assert.ok(initialMessageFor(pack, current, 1).includes('법인 전환'));
  await assert.rejects(() => startStep(pack, current, 1, async () => '답', NOW), /복사 방식/);
  assert.throws(() => pasteResult(pack, current, 1, '  ', NOW), /붙여넣어/);

  current = pasteResult(pack, current, 1, ' 다른 AI에서 받은 개요 ', NOW);
  assert.equal(resultOf(current, 1).final_output, '다른 AI에서 받은 개요');
  current = advance(pack, current, 1, NOW);
  assert.ok(initialMessageFor(pack, current, 2).includes('다른 AI에서 받은 개요'));
  assert.throws(() => pasteResult(pack, newRun(), 1, '결과', NOW), /복사 방식에서만/);
});

test('SEO: URL 단계는 고른 제목이 있어야 한다', () => {
  let current = newRun({ platform: 'custom_domain', mode: 'copy' });
  assert.throws(() => initialMessageFor(pack, current, 7), /제목/);
  current = selectTitle(current, ' 법인 전환 절차 5단계 ', NOW);
  const prompt = initialMessageFor(pack, current, 7);
  assert.ok(prompt.includes('법인 전환 절차 5단계'));
  assert.ok(!prompt.includes('{{selected_title}}'));
  assert.equal(selectTitle(current, '  ', NOW).selected_title, null);
});

test('SEO: 제목 단계의 결과에서 제목들을 꺼낸다', () => {
  const output = [
    '1.',
    'Title: 법인 전환 절차 5단계 정리',
    '(포함 요소: 검색의도 / 구체성)',
    'Description: 설명',
    '2.',
    '**Title:** **법인 전환, 언제 해야 할까**',
    '3.',
    'Title： 법인 전환 절차 5단계 정리',
  ].join('\n');
  assert.deepEqual(extractTitles(output), ['법인 전환 절차 5단계 정리', '법인 전환, 언제 해야 할까']);
  assert.deepEqual(extractTitles('제목 없음'), []);
});

test('SEO: 단계를 다시 하면 그 단계의 대화와 결과가 지워진다', async () => {
  let current = await startStep(pack, newRun(), 1, async () => '답', NOW);
  current = resetStep(current, 1, NOW);
  assert.deepEqual(current.results, {});
  current = await startStep(pack, current, 1, async () => '새 답', NOW);
  assert.equal(resultOf(current, 1).final_output, '새 답');
});
