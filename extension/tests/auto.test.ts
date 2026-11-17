// SEO 8단계를 한 번에 끝까지 돌리는 흐름을 가짜 AI로 시험한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../lib/llm/client.ts';
import type { PromptPack } from '../lib/prompts/pack.ts';
import {
  autoReplyFor,
  createRun,
  resultOf,
  runAll,
  sendMessage,
  startStep,
  stepsOf,
  stepUsesVoice,
  voiceAddition,
  type AutoSettings,
  type SeoRun,
} from '../lib/seo/engine.ts';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const pack = await buildPack();
const NOW = '2026-11-17T09:00:00.000Z';

const settings = (over: Partial<AutoSettings> = {}): AutoSettings => ({
  purpose: '상담 문의 유도',
  tone: '친절한 설명형',
  cta: '상담 신청',
  voice_card: '',
  past_titles: [],
  ...over,
});

const newRun = (over: Partial<Parameters<typeof createRun>[0]> = {}): SeoRun =>
  createRun({
    id: 'auto-1',
    platform: 'naver_blog',
    mode: 'api',
    main_keyword: '가업 승계',
    llm_provider: 'gemini',
    include_optional: true,
    now: NOW,
    auto: settings(),
    ...over,
  });

/** 부를 때마다 번호가 붙은 답을 주는 가짜 AI. 받은 대화를 적어 둔다. */
function fakeChat(answer: (n: number, messages: ChatMessage[]) => string = (n) => `AI 답 ${n}`) {
  const calls: ChatMessage[][] = [];
  const chat = async (messages: ChatMessage[]) => {
    calls.push(messages.map((m) => ({ ...m })));
    return answer(calls.length, messages);
  };
  return { chat, calls };
}

const lastUser = (messages: ChatMessage[]) => [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

test('한 번에: 묶음에는 AI가 되묻는 단계마다 대신 보낼 답이 있다', () => {
  const asking = pack.seo.steps.filter((s) => s.has_user_turn).map((s) => String(s.id));
  assert.deepEqual(Object.keys(pack.seo.auto_replies).sort(), asking.sort());
});

test('한 번에: 처음부터 끝까지 돌리고, 되묻는 단계에는 대신 답한다', async () => {
  const { chat, calls } = fakeChat();
  const seen: string[] = [];
  const outcome = await runAll(pack, newRun(), {
    chat,
    now: () => NOW,
    onChange: (_run, step, doing) => void seen.push(`${step.id}:${doing}`),
  });

  assert.equal(outcome.stop, 'done');
  assert.equal(outcome.step_id, null);
  assert.equal(outcome.run.status, 'completed');
  const steps = stepsOf(pack, outcome.run);
  assert.ok(steps.every((s) => outcome.run.results[s.id]?.completed_at === NOW));
  // 단계 7개 + 되묻는 단계의 답 3번
  assert.equal(calls.length, steps.length + steps.filter((s) => s.has_user_turn).length);

  // 되묻는 단계는 AI의 마지막 답이 결과가 된다
  for (const step of steps.filter((s) => s.has_user_turn)) {
    const result = resultOf(outcome.run, step.id);
    assert.equal(result.conversation.length, 4);
    assert.equal(result.final_output, result.conversation[3]?.content);
  }

  // 3단계의 답에는 시작할 때 받은 값이 들어간다. 채우지 못한 자리가 남지 않는다
  const draftReply = resultOf(outcome.run, 3).conversation[2]?.content ?? '';
  assert.ok(draftReply.includes('상담 문의 유도') && draftReply.includes('친절한 설명형') && draftReply.includes('상담 신청'));
  assert.ok(!/\{\{\w+\}\}/.test(draftReply));
  assert.ok(!draftReply.includes('[내 말투]'));
  assert.equal(resultOf(outcome.run, 4).conversation[2]?.content, '수정해줘');

  assert.deepEqual(seen.slice(0, 6), ['1:asking', '1:finished', '2:asking', '2:answering', '2:finished', '3:asking']);
});

test('한 번에: 내 말투와 이미 쓴 글 제목을 초안 단계의 답에 붙인다', () => {
  const run = newRun({ auto: settings({ voice_card: '- 문장 끝은 ~해요\n- 느낌표를 쓰지 않음', past_titles: ['가업 승계 절차', '증여세 계산'] }) });
  const step3 = pack.seo.steps.find((s) => s.id === 3);
  assert.ok(step3);
  const reply = autoReplyFor(pack, run, step3) ?? '';
  assert.ok(reply.includes('- 문장 끝은 ~해요'));
  assert.ok(reply.includes('- 가업 승계 절차\n- 증여세 계산'));
  assert.ok(!/\{\{\w+\}\}/.test(reply));
  // 말투 카드 안에 {{ }} 가 있어도 다시 바뀌지 않는다
  const tricky = newRun({ auto: settings({ voice_card: '{{cta}} 를 그대로 둔다' }) });
  assert.ok((autoReplyFor(pack, tricky, step3) ?? '').includes('{{cta}} 를 그대로 둔다'));
  // 되묻지 않는 단계에는 답이 없다
  const step1 = pack.seo.steps.find((s) => s.id === 1);
  assert.ok(step1);
  assert.equal(autoReplyFor(pack, run, step1), null);
});

test('한 번에: AI 호출이 실패하면 멈추고, 다시 부르면 이어서 한다 (같은 답을 두 번 보내지 않는다)', async () => {
  let saved: SeoRun = newRun();
  let n = 0;
  const calls: ChatMessage[][] = [];
  const flaky = async (messages: ChatMessage[]) => {
    n += 1;
    if (n === 4) throw new Error('연결 끊김');
    calls.push(messages);
    return `AI 답 ${n}`;
  };
  const deps = { chat: flaky, now: () => NOW, onChange: (run: SeoRun) => void (saved = run) };

  // 1단계, 2단계 시작, 2단계 답까지 되고 3단계 시작에서 실패한다
  await assert.rejects(() => runAll(pack, saved, deps), /연결 끊김/);
  assert.ok(saved.results[2]?.completed_at);
  assert.equal(saved.results[3], undefined);

  const outcome = await runAll(pack, saved, deps);
  assert.equal(outcome.stop, 'done');
  const steps = stepsOf(pack, outcome.run);
  assert.equal(calls.length, steps.length + 3);
  assert.equal(resultOf(outcome.run, 2).conversation.length, 4);
});

test('한 번에: 답을 보내다가 실패했으면 이어서 할 때 그 답부터 다시 보낸다', async () => {
  let saved: SeoRun = newRun();
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 3) throw new Error('한도 초과');
    return `AI 답 ${n}`;
  };
  const deps = { chat: flaky, now: () => NOW, onChange: (run: SeoRun) => void (saved = run) };
  await assert.rejects(() => runAll(pack, saved, deps), /한도 초과/);
  // 2단계는 시작만 됐고 답은 아직이다
  assert.equal(resultOf(saved, 2).conversation.length, 2);
  const outcome = await runAll(pack, saved, deps);
  assert.equal(outcome.stop, 'done');
  assert.equal(resultOf(outcome.run, 2).conversation.length, 4);
});

test('한 번에: 사람이 이미 답한 단계에는 또 답하지 않는다', async () => {
  let run = newRun();
  const first = fakeChat();
  run = await startStep(pack, run, 1, first.chat, NOW);
  const { chat, calls } = fakeChat();
  // 1단계를 끝내고, 2단계는 사람이 직접 답까지 해 둔 상태로 만든다
  const outcome1 = await runAll(pack, run, { chat, now: () => NOW, onChange: () => {}, shouldStop: () => calls.length >= 1 });
  assert.equal(outcome1.stop, 'stopped');
  let mid = outcome1.run;
  mid = await sendMessage(pack, mid, 2, '세 번째 소제목만 지워 주세요', chat, NOW);
  const before = calls.length;
  const outcome2 = await runAll(pack, mid, { chat, now: () => NOW, onChange: () => {} });
  assert.equal(outcome2.stop, 'done');
  assert.equal(resultOf(outcome2.run, 2).conversation.length, 4);
  assert.equal(resultOf(outcome2.run, 2).conversation[2]?.content, '세 번째 소제목만 지워 주세요');
  // 남은 단계: 3(2번), 4(2번), 5, 6, 8 = 7번
  assert.equal(calls.length - before, 7);
});

test('한 번에: [멈추기]를 누르면 다음 호출 전에 멈춘다', async () => {
  const { chat, calls } = fakeChat();
  const outcome = await runAll(pack, newRun(), { chat, now: () => NOW, onChange: () => {}, shouldStop: () => calls.length >= 2 });
  assert.equal(outcome.stop, 'stopped');
  assert.equal(calls.length, 2);
  assert.equal(outcome.run.status, 'in_progress');
});

test('한 번에: AI의 답이 잘리면 그 단계에서 멈춘다', async () => {
  const { chat, calls } = fakeChat();
  const outcome = await runAll(pack, newRun(), { chat, now: () => NOW, onChange: () => {}, wasTruncated: () => calls.length === 4 });
  // 4번째 호출은 3단계의 첫 프롬프트다
  assert.equal(outcome.stop, 'truncated');
  assert.equal(outcome.step_id, 3);
  assert.equal(resultOf(outcome.run, 3).conversation.length, 2);
  assert.equal(outcome.run.results[3]?.completed_at ?? null, null);
});

test('한 번에: 자체 도메인은 주소 단계에서 첫 번째 제목을 골라 쓴다', async () => {
  const titleStep = pack.seo.steps.find((s) => s.needs_selected_title);
  assert.ok(titleStep);
  const { chat, calls } = fakeChat((n, messages) =>
    lastUser(messages).includes('[프롬프트 6') ? `1.\nTitle: 가업 승계 절차 5단계\n\n2.\nTitle: 둘째 제목` : `AI 답 ${n}`,
  );
  const outcome = await runAll(pack, newRun({ platform: 'custom_domain' }), { chat, now: () => NOW, onChange: () => {} });
  assert.equal(outcome.stop, 'done');
  assert.equal(outcome.run.selected_title, '가업 승계 절차 5단계');
  const urlPrompt = calls.map((c) => lastUser(c)).find((text) => text.includes('[프롬프트 7')) ?? '';
  assert.ok(urlPrompt.includes('가업 승계 절차 5단계'));
});

test('한 번에: 고를 제목이 없으면 주소 단계에서 멈추고 알려 준다', async () => {
  const titleStep = pack.seo.steps.find((s) => s.needs_selected_title);
  assert.ok(titleStep);
  const { chat } = fakeChat(() => '제목이 없는 답');
  const outcome = await runAll(pack, newRun({ platform: 'custom_domain' }), { chat, now: () => NOW, onChange: () => {} });
  assert.equal(outcome.stop, 'needs-title');
  assert.equal(outcome.step_id, titleStep.id);
});

test('한 번에: 대신 보낼 답이 없는 단계에서는 멈추고 사람에게 넘긴다', async () => {
  const partial: PromptPack = JSON.parse(JSON.stringify(pack));
  delete partial.seo.auto_replies['3'];
  const { chat } = fakeChat();
  const outcome = await runAll(partial, newRun(), { chat, now: () => NOW, onChange: () => {} });
  assert.equal(outcome.stop, 'needs-answer');
  assert.equal(outcome.step_id, 3);
  assert.equal(resultOf(outcome.run, 3).conversation.length, 2);
});

test('한 번에: 한 단계씩 하는 글이나 복사 방식의 글은 돌리지 않는다', async () => {
  const { chat } = fakeChat();
  const deps = { chat, now: () => NOW, onChange: () => {} };
  await assert.rejects(() => runAll(pack, newRun({ auto: null }), deps), /한 번에 돌리는 방식/);
  const copy = newRun({ mode: 'copy' });
  assert.equal(copy.auto, null);
  await assert.rejects(() => runAll(pack, copy, deps), /한 번에 돌리는 방식/);
});

test('한 단계씩: 말투를 묻는 단계에서만 내 말투를 붙일 수 있고, 붙이는 글은 한 번에 돌릴 때와 같다', () => {
  // 말투를 묻는 단계는 하나뿐이다 (초안 단계)
  assert.deepEqual(pack.seo.steps.filter((s) => stepUsesVoice(pack, s)).map((s) => s.id), [3]);

  const card = '- 문장 끝은 ~해요';
  const titles = ['가업 승계 절차'];
  const addition = voiceAddition(pack, `  ${card}  `, titles);
  assert.ok(addition.voice.includes(card) && addition.past_titles.includes('- 가업 승계 절차'));
  assert.deepEqual(voiceAddition(pack, '   ', []), { voice: '', past_titles: '' });

  // 한 번에 돌릴 때 보내는 답 안에 같은 글이 그대로 들어 있다
  const step3 = pack.seo.steps.find((s) => s.id === 3);
  assert.ok(step3);
  const reply = autoReplyFor(pack, newRun({ auto: settings({ voice_card: card, past_titles: titles }) }), step3) ?? '';
  assert.ok(reply.includes(addition.voice + addition.past_titles));
});
