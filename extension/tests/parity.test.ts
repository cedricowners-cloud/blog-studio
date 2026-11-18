// 확장에 옮긴 글쓰기 코드가 웹의 코드와 같은 결과를 내는지 확인한다.
// 웹의 진짜 코드(web/lib/...)를 불러와 같은 입력을 넣고 결과를 견준다.
// 웹 코드나 프롬프트가 바뀌어 달라지면 여기서 실패한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { validate } from '../lib/writer/axiom-validator.ts';
import { buildFullPrompt } from '../lib/writer/prompt-builder.ts';
import { parse } from '../lib/writer/response-parser.ts';
import { buildFeedback } from '../lib/writer/retry-loop.ts';
import type { BlogGenerationInput } from '../lib/writer/types.ts';
import { buildStepInitialMessage, extractFirstTitle, getStepsForPlatform } from '../lib/seo/engine.ts';
import { applyRewrites, buildCards, buildRewritePrompt, parseRewrites, parseSections, rewritePayload } from '../lib/cards/parser.ts';
import { buildPack, REPO_ROOT } from '../scripts/build-prompt-pack.ts';
import { GLUE } from '../scripts/glue.ts';

const webLib = join(REPO_ROOT, 'web', 'lib');
const load = (...parts: string[]) => import(pathToFileURL(join(webLib, ...parts)).href);

process.env.PROMPTS_DIR = join(REPO_ROOT, 'web', 'prompts');

const pack = await buildPack();
const webBuilder = (await load('ontology', 'prompt-builder.ts')) as { buildFullPrompt: (inp: unknown) => Promise<string> };
const webParser = (await load('ontology', 'response-parser.ts')) as { parse: (raw: string) => unknown };
const webValidator = (await load('ontology', 'axiom-validator.ts')) as {
  validate: (check: Record<string, unknown>, methodId?: number, body?: string, pack?: null) => unknown;
};
const webSeo = (await load('seo-workflow.ts')) as {
  SEO_WORKFLOW: unknown[];
  getStepsForPlatform: (platform: string, includeOptional: boolean) => { id: number }[];
};
const webSeoEngine = (await load('seo-workflow-engine.ts')) as {
  buildStepInitialMessage: (step: unknown, ctx: unknown) => string;
  extractFirstTitle: (text: string) => string | null;
};

// 웹의 방식 6 은 사실 자료가 비면 경고를 찍는다. 시험 출력이 지저분해지지 않게 잠시 막는다.
const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await work();
  } finally {
    console.warn = original;
  }
};

const base = (methodId: number): BlogGenerationInput => ({
  method_id: methodId,
  topic: '2026 소상공인 정책자금 신청 방법',
  main_keyword: '소상공인 정책자금',
  sub_keywords: ['정책자금 신청', '운전자금', '융자 한도'],
});

const variants: Record<string, (methodId: number) => BlogGenerationInput> = {
  '꼭 필요한 값만': base,
  '모든 값': (id) => ({
    ...base(id),
    target_awareness_level: 'L3',
    search_intent: '절차해결',
    jtbd_type: '리스크회피',
    persona: '40대 제조업 대표, 운전자금이 급함',
    author_persona: '경영 컨설턴트 10년, 차분하고 정확한 말투',
    brand_voice: { author_identity: '정책자금 전문 컨설턴트', consultancy_name: '가나다 경영연구소' },
    domain_info: { 사업명: '혁신성장촉진자금', 주관기관: '소상공인시장진흥공단', 메모: '한도 2억원, 금리는 분기마다 바뀜' },
    generation_options: { max_retries: 1, axiom_pass_threshold: 0.9, min_body_char_count: 1800 },
    research_context: [
      { title: '정책자금 총정리', description: '요약 글', body: '본문 발췌 글', link: 'https://example.com/a', bloggername: '블로거A' },
      { title: '', link: 'https://example.com/b' },
      { title: '제목만 있는 글' },
    ],
  }),
  '일부만': (id) => ({
    ...base(id),
    author_persona: '',
    brand_voice: { consultancy_name: '소속만 있음' },
    domain_info: {},
    research_context: [],
  }),
  '까다로운 글자': (id) => ({
    ...base(id),
    topic: '주제에 {main_keyword} 와 {{topic}} 와 $& 가 들어 있음',
    main_keyword: '키워드 $1 `백틱`',
    persona: '{author_persona} 를 닮은 독자',
    brand_voice: { author_identity: '{{v}}' },
  }),
};

for (const [name, make] of Object.entries(variants)) {
  for (const methodId of [1, 2, 3, 4, 5, 6]) {
    test(`프롬프트 조립이 웹과 같다: 방식 ${methodId} · ${name}`, async () => {
      const input = make(methodId);
      const expected = await quiet(() => webBuilder.buildFullPrompt(JSON.parse(JSON.stringify(input))));
      assert.equal(buildFullPrompt(pack, input), expected);
    });
  }
}

test('입력이 모자라면 웹과 마찬가지로 조립하지 않는다', async () => {
  const bad = { ...base(1), topic: ' ', sub_keywords: [] };
  await assert.rejects(() => webBuilder.buildFullPrompt(bad));
  assert.throws(() => buildFullPrompt(pack, bad));
  assert.throws(() => buildFullPrompt(pack, { ...base(1), method_id: 9 }));
});

const goodAnswer = {
  mapping: { reader_mapping: { awareness_level: 'L2' } },
  titles: [{ rank: 1, title: '제목 하나' }],
  body: '[h2]소제목[/h2]\n본문입니다.',
  axiom_check: { items: [{ number: 1, rule: '규칙', passed: true, evidence: '근거' }] },
  suggestions: {},
  meta: { method_id: 6 },
};

const rawAnswers: Record<string, string> = {
  '그대로 JSON': JSON.stringify(goodAnswer),
  '코드 울타리 안': '설명입니다.\n```json\n' + JSON.stringify(goodAnswer, null, 2) + '\n```\n끝.',
  '앞뒤에 글': '아래가 결과입니다. ' + JSON.stringify(goodAnswer) + ' 이상입니다.',
  '중간에 잘림': JSON.stringify(goodAnswer).slice(0, 80),
  '빈 글': '',
  '배열': '[1, 2, 3]',
  '칸이 빠짐': JSON.stringify({ titles: [], body: '본문' }),
  '모양이 다름': JSON.stringify({ ...goodAnswer, titles: '제목', body: 12, mapping: [] }),
  'JSON 이 아님': '죄송합니다. 만들 수 없습니다.',
};

for (const [name, raw] of Object.entries(rawAnswers)) {
  test(`답 해석이 웹과 같다: ${name}`, () => {
    assert.deepEqual(parse(raw), webParser.parse(raw));
  });
}

const axiomSamples: Record<string, Record<string, unknown>> = {
  '비어 있음': {},
  '빈 목록': { items: [] },
  '모두 통과': { items: Array.from({ length: 17 }, (_, i) => ({ number: i + 1, rule: `규칙 ${i + 1}`, passed: true })) },
  '몇 개 실패': {
    items: [
      { number: 1, rule: '메인 키워드 제목 앞', passed: true, evidence: '제목 첫 단어' },
      { number: 2, rule: '본문 1500자', passed: false, evidence: '1200자' },
      { number: 11, rule: '가치명제', passed: false },
      { number: 12, rule: '핵심답', passed: true },
      { number: 13, passed: false },
    ],
  },
  '브랜드 보이스가 섞임': {
    items: [
      { number: 1, rule: '규칙', passed: true },
      { number: 101, rule: 'BV1 따뜻한 말투', passed: false },
      { rule: 'Brand Voice — 단정하지 않기', passed: true },
      { number: 5, rule: '분류가 적힘', category: '4c', passed: false, evidence: '근거' },
      { number: 6, rule: '브랜드 보이스', category: 'algorithm', passed: false },
    ],
  },
  '이상한 항목': { items: [null, 3, '글자', { number: 3, rule: '정상', passed: 1 }, { passed: false }] },
};

for (const [name, sample] of Object.entries(axiomSamples)) {
  for (const methodId of [undefined, 1, 6]) {
    test(`통과 조건 세기가 웹과 같다: ${name} · 방식 ${methodId ?? '없음'}`, () => {
      const expected = webValidator.validate(JSON.parse(JSON.stringify(sample)), methodId, '본문', null);
      assert.deepEqual(validate(JSON.parse(JSON.stringify(sample)), methodId), expected);
    });
  }
}

// 웹의 다시 쓰기 요청 글(buildFeedback)은 바깥에서 부를 수 없게 돼 있다.
// 소스에서 그 함수만 꺼내 타입을 지우고 돌려서 견준다.
const strip = (nodeModule as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
const retrySource = readFileSync(join(webLib, 'ontology', 'retry-loop.ts'), 'utf-8');

test('다시 쓰기 요청 글이 웹과 같다', { skip: strip ? false : '이 Node 에는 타입을 지우는 기능이 없어요' }, () => {
  const start = retrySource.indexOf('function buildFeedback(');
  const end = retrySource.indexOf('export interface RunOptions');
  assert.ok(start >= 0 && end > start, '웹 소스에서 buildFeedback 을 찾지 못했어요');
  const js = (strip as (code: string) => string)(retrySource.slice(start, end));
  const webBuildFeedback = new Function(js + '\nreturn buildFeedback;')() as (
    prev: string,
    failed: unknown[],
    parsed: unknown,
    tooShort: boolean,
    min: number,
  ) => string;

  const parsed = parse(JSON.stringify({ ...goodAnswer, body: '짧은 본문 '.repeat(900) }));
  const cases: { failed: { number?: number; rule: string; evidence?: string }[]; tooShort: boolean }[] = [
    { failed: [], tooShort: false },
    { failed: [], tooShort: true },
    { failed: [{ number: 2, rule: '본문 1500자', evidence: '1200자' }, { rule: '번호 없는 규칙' }, { number: 7, rule: '근거 없음', evidence: '' }], tooShort: false },
    { failed: [{ number: 11, rule: '가치명제 {{rule}} $&', evidence: '{{body}}' }], tooShort: true },
  ];
  for (const c of cases) {
    assert.equal(
      buildFeedback(pack, '앞 프롬프트', c.failed, parsed, c.tooShort, 1500),
      webBuildFeedback('앞 프롬프트', c.failed, parsed, c.tooShort, 1500),
    );
  }
});

test('SEO 8단계의 프롬프트와 순서가 웹과 같다', () => {
  assert.deepEqual(pack.seo.steps, JSON.parse(JSON.stringify(webSeo.SEO_WORKFLOW)));
  for (const platform of ['naver_blog', 'custom_domain'] as const) {
    for (const includeOptional of [true, false]) {
      assert.deepEqual(
        getStepsForPlatform(pack, platform, includeOptional).map((s) => s.id),
        webSeo.getStepsForPlatform(platform, includeOptional).map((s) => s.id),
      );
    }
  }
});

test('SEO 단계의 첫 프롬프트가 웹과 같다', () => {
  const contexts = [
    { main_keyword: '법인 전환', prev_output: '앞 단계의 결과\n둘째 줄', selected_title: '법인 전환 절차 5단계' },
    { main_keyword: '가업 승계 {{main_keyword}}', prev_output: '{{prompt}} 가 들어 있는 결과', selected_title: '제목 {{prev}}' },
  ];
  for (const ctx of contexts) {
    for (const step of pack.seo.steps) {
      assert.equal(buildStepInitialMessage(pack, step, ctx), webSeoEngine.buildStepInitialMessage(step, ctx), `단계 ${step.id}`);
    }
  }
  // 꼭 필요한 값이 없으면 양쪽 다 멈춘다
  for (const step of pack.seo.steps) {
    const ctx = { main_keyword: '키워드', prev_output: null, selected_title: null };
    const webThrows = (() => {
      try {
        webSeoEngine.buildStepInitialMessage(step, ctx);
        return false;
      } catch {
        return true;
      }
    })();
    if (webThrows) assert.throws(() => buildStepInitialMessage(pack, step, ctx), `단계 ${step.id}`);
    else assert.equal(buildStepInitialMessage(pack, step, ctx), webSeoEngine.buildStepInitialMessage(step, ctx));
  }
});

test('제목 꺼내기가 웹과 같다', () => {
  const samples = [
    '1.\nTitle: 법인 전환 절차 5단계 정리\n(포함 요소: 검색의도)\n\nDescription: 설명\n\n2.\nTitle: 둘째 제목',
    'title： 전각 쌍점을 쓴 제목  ',
    '제목이 없는 글',
    '',
  ];
  for (const sample of samples) assert.equal(extractFirstTitle(sample), webSeoEngine.extractFirstTitle(sample));
});

test('옮겨 적은 글 조각이 웹 소스에 그대로 있다', () => {
  const sources: Record<string, string> = {
    input: readFileSync(join(webLib, 'ontology', 'prompt-builder.ts'), 'utf-8'),
    research: readFileSync(join(webLib, 'ontology', 'prompt-builder.ts'), 'utf-8'),
    default: readFileSync(join(webLib, 'ontology', 'prompt-builder.ts'), 'utf-8'),
    feedback: retrySource,
    seo: readFileSync(join(webLib, 'seo-workflow-engine.ts'), 'utf-8'),
  };
  for (const [key, template] of Object.entries(GLUE)) {
    const source = sources[key.split('.')[0] as string];
    assert.ok(source, `${key} 의 원본 파일을 모르겠어요`);
    for (const fragment of template.split(/\{\{\w+\}\}|\n/)) {
      if (fragment.trim().length < 2) continue;
      assert.ok(source.includes(fragment), `"${key}" 의 조각이 웹 소스에 없어요: ${fragment}`);
    }
  }
});

// ───────────── 블로그용 카드 ─────────────
// 웹의 cards-parser.ts 는 "./llm" 을 확장자 없이 불러와서 Node 에서 그대로 불러올 수 없다.
// 소스에서 그 줄을 빼고 타입을 지운 뒤 돌려서 견준다. AI 호출은 가짜로 바꿔 넣는다.
const cardsSource = readFileSync(join(webLib, 'cards-parser.ts'), 'utf-8');
type WebCards = {
  parseSections: (body: string) => unknown;
  buildCards: (opts: Record<string, unknown>) => Promise<unknown[]>;
};
function loadWebCards(llmGenerate: (prompt: string) => Promise<{ text: string }>): WebCards {
  const js = (strip as (code: string) => string)(cardsSource.replace(/^import .*$/m, '')).replace(/^export /gm, '');
  return new Function('llmGenerate', js + '\nreturn { parseSections, buildCards };')(llmGenerate) as WebCards;
}

const cardBodies: Record<string, string> = {
  '블로그 마크업': '[h2]가업 승계란[/h2]\n가업을 물려주는 일입니다. [bold]세금[/bold]이 가장 큰 문제입니다. 준비는 10년 전부터 합니다!\n[quote]인용은 빠진다[/quote]\n| 표 | 줄 |\n|---|---|\n| 도 | 빠진다 |\n[hr]\n[h2]증여세 계산[/h2]\n과세표준에 세율을 곱합니다. 공제는 10년 동안 5천만 원입니다. 신고는 3개월 안에 합니다. 넷째 문장은 쓰지 않습니다.\n[IMG: 자리 - 사진]\n[h2]내용이 없는 소제목[/h2]\n',
  '마크다운 (SEO 결과)': '# 법인 전환 절차\n\n법인 전환은 **개인사업자**가 법인으로 바꾸는 일입니다. 절차는 5단계입니다.\n\n[이미지 제안]\n- 위치: H2 아래\n- 유형: 비교표\n\n## 언제 해야 하나요?\n\n- 매출이 늘 때\n- 세율이 부담될 때\n\n1. 먼저 상담합니다.\n2. 그다음 [서류](https://example.com)를 준비합니다.\n\n## 빈 소제목\n\n### 비용은 얼마인가요\n\n| 항목 | 금액 |\n|---|---|\n| 등기 | 100만 원 |\n\n대략 200만 원쯤 듭니다.',
  '소제목 없는 글': '첫 문단입니다. 문장이 둘입니다.\n\n둘째 문단은 아주 길어서 제목으로 쓸 때 마흔 글자에서 잘립니다 정말로 길게 써서 넘치게 만들어 봅니다 이 정도면 넘습니다.\n\n셋째 문단.',
  '빈 글': '',
};

for (const [name, cardBody] of Object.entries(cardBodies)) {
  test(`카드: 소제목 나누기와 규칙으로 만든 카드가 웹과 같다 · ${name}`, { skip: strip ? false : '이 Node 에는 타입을 지우는 기능이 없어요' }, async () => {
    const web = loadWebCards(async () => ({ text: '' }));
    assert.deepEqual(parseSections(cardBody), web.parseSections(cardBody));
    for (const options of [{}, { keywords: ['가업 승계', '증여세', '아주 길어서 스물네 글자에서 잘리는 키워드입니다 정말로'] }, { cardCount: 5 }, { maxContentCards: 1 }]) {
      const mine = buildCards({ title: '[bold]제목[/bold] 입니다', body: cardBody, ...options });
      assert.deepEqual(mine.cards, await web.buildCards({ title: '[bold]제목[/bold] 입니다', body: cardBody, ...options }));
    }
  });
}

test('카드: AI로 다듬는 프롬프트와 다듬은 결과가 웹과 같다', { skip: strip ? false : '이 Node 에는 타입을 지우는 기능이 없어요' }, async () => {
  const cardBody = cardBodies['블로그 마크업'] as string;
  const title = '가업 승계 준비 {{total}}';
  // AI는 2번을 빠뜨리고 답한다. 웹은 한 번 더 묻는다.
  const answers = [
    '설명입니다.\n```json\n{"cards":[{"index":1,"lead":" 다듬은 핵심 문장입니다. ","body_text":"다듬은 설명입니다."},{"index":3,"lead":"","body_text":"셋째 설명입니다."}]}\n```',
    '{"cards":[{"index":2,"lead":"둘째 핵심입니다.","body_text":"  "},{"index":1,"lead":"덮어쓰면 안 되는 문장","body_text":"x"}]}',
  ];
  const prompts: string[] = [];
  const replies = [...answers];
  const web = loadWebCards(async (prompt) => {
    prompts.push(prompt);
    return { text: replies.shift() ?? '' };
  });
  const webCards = await web.buildCards({ title, body: cardBody, ai: { provider: 'gemini' } });

  // 프롬프트
  const built = buildCards({ title, body: cardBody });
  const payload = rewritePayload(built.cards, built.usedSections);
  assert.equal(payload.length, 3);
  assert.equal(buildRewritePrompt(pack, title, payload), prompts[0]);
  assert.equal(prompts.length, 2, '빠진 번호가 있어서 웹이 한 번 더 물었다');

  // 결과: 첫 답을 먼저 쓰고, 다시 물은 답에서는 빠졌던 번호만 채운다
  const first = parseRewrites(answers[0] as string);
  const second = parseRewrites(answers[1] as string);
  assert.ok(first && second);
  for (const [index, value] of second) if (!first.has(index)) first.set(index, value);
  assert.deepEqual(applyRewrites(built.cards, first), webCards);

  // 묶음에 프롬프트가 없으면 (예전 묶음) 만들지 않는다
  const oldPack = JSON.parse(JSON.stringify(pack));
  delete oldPack.glue['cards.rewrite'];
  assert.equal(buildRewritePrompt(oldPack, title, payload), null);
  assert.equal(parseRewrites('JSON 이 아님'), null);
});
