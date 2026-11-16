import { llmGenerate, resolveMaxTokens } from '../../lib/llm/client';
import type { PromptPack } from '../../lib/prompts/pack';
import { addUsage, loadHistory, loadPack, loadWriteForm, onStoreChange, pushHistory, saveWriteForm, type WrittenPost } from '../../lib/store';
import type { AxiomFailedItem } from '../../lib/writer/axiom-validator';
import { buildFullPrompt, checkInput, findMethod } from '../../lib/writer/prompt-builder';
import { run, type LoopResult } from '../../lib/writer/retry-loop';
import {
  AWARENESS_LEVELS,
  JTBD_TYPES,
  SEARCH_INTENTS,
  type AwarenessLevel,
  type BlogGenerationInput,
  type JtbdType,
  type SearchIntent,
} from '../../lib/writer/types';
import { createAiPicker } from './ai-picker';
import { errorText, field, guarded, h, num, option, seconds, setMessage } from './dom';

// 글쓰기 화면: 글쓰기 방식 6개 중 하나로 글을 만든다. 웹의 "글 생성"과 같은 프롬프트, 같은 검사를 쓴다.
// 다른 점: AI를 내 키로 직접 부른다. 업종 설정과 상위 글 조사는 아직 없다 (로그인을 붙인 뒤에 넣는다).

export interface WriteDeps {
  sendToFill: (title: string, body: string) => void;
  openSettings: () => void;
}

const AWARENESS_LABELS: Record<AwarenessLevel, string> = {
  L1: 'L1 · 이 주제를 아직 모름',
  L2: 'L2 · 내가 해당되는지 궁금함',
  L3: 'L3 · 어떻게 하는지 궁금함',
  L4: 'L4 · 해 봤는데 잘 안 됐음',
};

/** 웹에서 쓰던 값. 모델의 한도를 모를 때 쓴다 */
const WEB_MAX_TOKENS = 16000;
/** 모델의 한도를 알 때 바라는 값. 생각하는 데 쓰는 몫까지 넉넉히 준다 */
const WANTED_MAX_TOKENS = 32000;

const FACTS_TEMPLATE = JSON.stringify({ 사업명: '', 주관기관: '', 메모: '자격, 지원 금액, 신청 기한, 필요 서류처럼 글에 꼭 들어갈 사실을 적어 주세요' }, null, 2);

const countNeedsCheck = (body: string): number => (body.match(/확인\s?필요/g) ?? []).length;

/** 검사 코드가 남긴 메모를 쉬운 말로 바꾼다. (메모의 글자는 웹과 같게 두어야 해서 여기서 바꾼다) */
function plainNote(note: string): string {
  const short = /^알고리즘 공리 수 부족: (\d+)\/(\d+)/.exec(note);
  if (short) return `AI가 점검한 조건이 ${short[1]}개예요. 이 방식은 ${short[2]}개를 점검해야 해요. 빠뜨린 조건이 있을 수 있어요.`;
  if (note.startsWith('axiom_check.items')) return 'AI가 조건을 점검한 결과를 보내지 않았어요.';
  return note;
}

interface ShownPost {
  titles: string[];
  body: string;
  summary: string;
  tone: 'ok' | 'warn' | 'bad';
  failed: AxiomFailedItem[];
  notes: string[];
  raw?: string;
  suggestions?: Record<string, unknown>;
}

export function createWriteSection(deps: WriteDeps): HTMLElement {
  let pack: PromptPack | null = null;
  let stopper: AbortController | null = null;

  const needPack = h('section', { class: 'card' },
    h('h2', null, '글쓰기'),
    h('p', { class: 'message warn' }, '프롬프트 묶음을 아직 불러오지 않았어요. 설정에서 먼저 불러와 주세요.'),
  );
  const toSettings = h('button', { type: 'button', class: 'primary' }, '설정 열기');
  toSettings.addEventListener('click', deps.openSettings);
  needPack.append(h('div', { class: 'buttons' }, toSettings));

  // 입력 칸
  const methodSelect = h('select', { class: 'field' });
  const topic = h('input', { type: 'text', class: 'field', placeholder: '예: 2026 소상공인 혁신성장촉진자금 신청 방법' });
  const mainKeyword = h('input', { type: 'text', class: 'field', placeholder: '예: 혁신성장촉진자금' });
  const subKeywords = h('input', { type: 'text', class: 'field', placeholder: '쉼표로 나눠 적어요. 예: 정책자금 신청, 융자 한도' });
  const awareness = h('select', { class: 'field' }, ...AWARENESS_LEVELS.map((v) => option(v, AWARENESS_LABELS[v], v === 'L2')));
  const persona = h('input', { type: 'text', class: 'field', placeholder: '예: 40대 제조업 대표, 운전자금이 급함' });
  const authorPersona = h('input', { type: 'text', class: 'field', placeholder: '예: 경영 컨설턴트 10년, 차분하고 정확한 말투' });
  const facts = h('textarea', { class: 'field prose', rows: '5', placeholder: '글에 들어갈 사실을 적어요. 공고 내용을 붙여넣어도 돼요.' });
  const searchIntent = h('select', { class: 'field' }, option('', '정하지 않음', true), ...SEARCH_INTENTS.map((v) => option(v, v)));
  const jtbd = h('select', { class: 'field' }, option('', '정하지 않음', true), ...JTBD_TYPES.map((v) => option(v, v)));
  const authorIdentity = h('input', { type: 'text', class: 'field', placeholder: '예: 정책자금 전문 컨설턴트' });
  const consultancy = h('input', { type: 'text', class: 'field', placeholder: '예: 가나다 경영연구소' });

  const inputs: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {
    method: methodSelect, topic, mainKeyword, subKeywords, awareness, persona, authorPersona, facts,
    searchIntent, jtbd, authorIdentity, consultancy,
  };

  const factsHint = h('span', { class: 'hint small' });
  const templateButton = h('button', { type: 'button' }, '틀 넣기');
  templateButton.addEventListener('click', () => {
    facts.value = FACTS_TEMPLATE;
    remember();
  });

  const picker = createAiPicker(deps.openSettings);
  const makeButton = h('button', { type: 'button', class: 'primary' }, '글 만들기');
  const stopButton = h('button', { type: 'button' }, '멈추기');
  const promptButton = h('button', { type: 'button' }, '프롬프트 복사');
  const status = h('p', { class: 'message' });
  const resultBox = h('div', { class: 'stack' });
  const historyBox = h('div', null);
  stopButton.hidden = true;

  const say = (text: string, tone: 'ok' | 'warn' | 'bad' | '' = '') => setMessage(status, text, tone);

  function drawMethods(): void {
    const chosen = methodSelect.value;
    methodSelect.replaceChildren(...(pack?.methods.items ?? []).map((m) => option(String(m.id), `${m.id}. ${m.label}`, String(m.id) === chosen)));
    drawFactsHint();
  }

  function drawFactsHint(): void {
    if (!pack) return;
    const isGovInfo = /정부지원/.test(findMethod(pack, Number(methodSelect.value))?.label ?? '');
    factsHint.textContent = isGovInfo
      ? '이 방식은 사실 자료가 꼭 필요해요. 공고의 내용을 붙여넣어 주세요. 링크만 넣으면 내용을 가져오지 못해요 (웹과 다른 점이에요).'
      : '비워도 돼요. 적지 않은 숫자나 날짜는 AI가 "확인 필요"로 표시해요.';
    templateButton.hidden = !isGovInfo;
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function remember(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveWriteForm(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
    }, 400);
  }
  for (const el of Object.values(inputs)) el.addEventListener('input', remember);
  methodSelect.addEventListener('change', drawFactsHint);

  function parseFacts(): Record<string, unknown> | undefined {
    const text = facts.value.trim();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { 메모: String(parsed) };
    } catch {
      return { 메모: text };
    }
  }

  function readInput(): BlogGenerationInput {
    const brand = { author_identity: authorIdentity.value.trim() || null, consultancy_name: consultancy.value.trim() || null };
    return {
      method_id: Number(methodSelect.value),
      topic: topic.value.trim(),
      main_keyword: mainKeyword.value.trim(),
      sub_keywords: subKeywords.value.split(',').map((s) => s.trim()).filter(Boolean),
      target_awareness_level: awareness.value as AwarenessLevel,
      search_intent: (searchIntent.value || undefined) as SearchIntent | undefined,
      jtbd_type: (jtbd.value || undefined) as JtbdType | undefined,
      persona: persona.value.trim() || undefined,
      author_persona: authorPersona.value.trim() || undefined,
      brand_voice: brand.author_identity || brand.consultancy_name ? brand : undefined,
      domain_info: parseFacts(),
    };
  }

  function showPost(post: ShownPost): void {
    resultBox.replaceChildren();
    const bodyArea = h('textarea', { class: 'field prose tall', rows: '14' });
    bodyArea.value = post.body;
    const counter = h('p', { class: 'hint small' });
    const drawCounter = () => {
      const marks = countNeedsCheck(bodyArea.value);
      counter.textContent = `본문 ${num(bodyArea.value.length)}자` + (marks > 0 ? ` · "확인 필요" 표시 ${marks}곳. 채우기 전에 직접 확인해서 고쳐 주세요.` : '');
      counter.className = marks > 0 ? 'hint small warn' : 'hint small';
    };
    bodyArea.addEventListener('input', drawCounter);
    drawCounter();

    const titleInput = h('input', { type: 'text', class: 'field', placeholder: '제목' });
    titleInput.value = post.titles[0] ?? '';
    const titleChoices = h('div', { class: 'choices' },
      ...post.titles.map((t, i) => {
        const radio = h('input', { type: 'radio', name: 'write-title' });
        radio.checked = i === 0;
        radio.addEventListener('change', () => {
          titleInput.value = t;
        });
        return h('label', { class: 'choice' }, radio, h('span', null, t));
      }),
    );

    const fillButton = h('button', { type: 'button', class: 'primary' }, '채우기로 보내기');
    const copyButton = h('button', { type: 'button' }, '본문 복사');
    const note = h('p', { class: 'message' });
    fillButton.addEventListener('click', () => deps.sendToFill(titleInput.value.trim(), bodyArea.value));
    copyButton.addEventListener('click', () =>
      guarded(copyButton, (m) => setMessage(note, m, 'bad'), async () => {
        await navigator.clipboard.writeText(bodyArea.value);
        setMessage(note, '본문을 복사했어요.', 'ok');
      }),
    );

    const card = h('section', { class: 'card' },
      h('h2', null, '만든 글'),
      h('p', { class: 'message ' + post.tone }, post.summary),
      ...post.notes.map((n) => h('p', { class: 'hint small' }, n)),
    );

    if (post.failed.length > 0) {
      card.append(
        h('details', null,
          h('summary', null, `채우지 못한 조건 ${post.failed.length}개`),
          h('ul', { class: 'plain' },
            ...post.failed.map((f) =>
              h('li', null, `${f.number ?? '-'}. ${f.rule}`, f.evidence ? h('span', { class: 'hint small' }, ' · ' + f.evidence) : null),
            ),
          ),
        ),
      );
    }

    if (post.body) {
      if (post.titles.length > 0) card.append(h('p', { class: 'label' }, '제목 고르기'));
      card.append(
        titleChoices,
        titleInput,
        bodyArea,
        counter,
        h('div', { class: 'buttons' }, fillButton, copyButton),
        note,
      );
    }
    if (post.suggestions && Object.keys(post.suggestions).length > 0) {
      card.append(h('details', null, h('summary', null, 'AI의 제안'), h('pre', { class: 'output' }, JSON.stringify(post.suggestions, null, 2))));
    }
    if (post.raw) {
      card.append(h('details', null, h('summary', null, 'AI가 보낸 답 그대로 보기'), h('pre', { class: 'output' }, post.raw)));
    }
    resultBox.append(card);
  }

  function showLoop(loop: LoopResult): ShownPost {
    const axiom = loop.final_axiom;
    const last = loop.attempts[loop.attempts.length - 1];
    const notes: string[] = [
      `시도 ${loop.attempts.length}번 · ${seconds(loop.total_duration_ms)} · 모델 ${loop.model} · 보낸 글 ${num(loop.usage.input_tokens)}토큰 · 받은 글 ${num(loop.usage.output_tokens)}토큰`,
      ...axiom.notes.map(plainNote),
    ];
    if (last?.truncated) notes.push('AI의 답이 길이 한도에 걸려 중간에 잘렸어요. 설정에서 더 큰 모델을 고르면 나아질 수 있어요.');

    const titles = loop.final.titles.map((t) => (typeof t.title === 'string' ? t.title : '')).filter(Boolean);
    let summary: string;
    let tone: ShownPost['tone'];
    if (!loop.final.body) {
      summary = 'AI의 답에서 글을 읽어 내지 못했어요. 다시 만들어 주세요.';
      tone = 'bad';
    } else if (loop.needs_human_review) {
      summary = `조건 ${axiom.total}개 중 ${axiom.passed}개만 채웠어요. 꼭 읽어 보고 고쳐 주세요.`;
      tone = 'warn';
    } else {
      summary = `조건 ${axiom.total}개를 모두 채웠어요 (AI가 스스로 점검한 결과예요. 사실은 직접 확인해 주세요).`;
      tone = 'ok';
    }
    return {
      titles,
      body: loop.final.body,
      summary,
      tone,
      failed: axiom.failed_items,
      notes,
      raw: loop.final.parse_ok ? undefined : loop.final.raw,
      suggestions: loop.final.suggestions,
    };
  }

  async function drawHistory(): Promise<void> {
    const list = await loadHistory();
    historyBox.replaceChildren();
    if (list.length === 0) return;
    historyBox.append(
      h('section', { class: 'card' },
        h('details', null,
          h('summary', null, `최근에 만든 글 ${list.length}개 (이 컴퓨터에만 있어요)`),
          h('ul', { class: 'plain' },
            ...list.map((post) => {
              const open = h('button', { type: 'button', class: 'link' }, post.titles[0] || post.topic);
              open.addEventListener('click', () => {
                showPost({
                  titles: post.titles,
                  body: post.body,
                  summary: post.needs_review
                    ? `조건 ${post.total}개 중 ${post.passed}개만 채운 글이에요. 꼭 읽어 보고 고쳐 주세요.`
                    : `조건 ${post.total}개를 모두 채운 글이에요.`,
                  tone: post.needs_review ? 'warn' : 'ok',
                  failed: [],
                  notes: [`${post.created_at.slice(0, 16).replace('T', ' ')} · ${post.method_label} · 모델 ${post.model}`],
                });
                resultBox.scrollIntoView({ behavior: 'smooth' });
              });
              return h('li', null, open, h('span', { class: 'hint small' }, ` · ${post.created_at.slice(5, 10)} · ${post.method_label}`));
            }),
          ),
        ),
      ),
    );
  }

  async function make(): Promise<void> {
    if (!pack) return;
    const input = readInput();
    const problems = checkInput(pack, input);
    if (problems.length > 0) {
      say(problems.join(' '), 'warn');
      return;
    }
    const ai = picker.current();
    if (!ai) {
      say('AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.', 'warn');
      return;
    }

    const activePack = pack;
    stopper = new AbortController();
    const startedAt = Date.now();
    let attempt = 1;
    let chars = 0;
    let waiting = '';
    const draw = () =>
      say(`${attempt}번째 시도 · ${waiting || (chars > 0 ? `받은 글 ${num(chars)}자` : 'AI가 생각하는 중')} · ${seconds(Date.now() - startedAt)} · 만드는 동안 이 창을 닫지 마세요`);
    const ticker = setInterval(draw, 1000);
    makeButton.disabled = true;
    stopButton.hidden = false;
    resultBox.replaceChildren();
    draw();

    try {
      const loop = await run(activePack, input, {
        generate: async (prompt, n) => {
          attempt = n;
          chars = 0;
          const result = await llmGenerate(prompt, {
            provider: ai.provider,
            model: ai.model,
            apiKey: ai.key,
            temperature: 0.7,
            maxTokens: resolveMaxTokens(WANTED_MAX_TOKENS, WEB_MAX_TOKENS, ai.modelInfo),
            signal: stopper?.signal,
            onProgress: (count) => {
              chars = count;
              waiting = '';
            },
            onRetry: (waitMs, why) => {
              waiting = `${why} · ${seconds(waitMs)} 뒤에 다시 시도`;
            },
          });
          await addUsage(ai.provider, result.usage);
          return result;
        },
        onAttempt: (record, willRetry) => {
          if (willRetry) waiting = `조건 ${record.axiom.total}개 중 ${record.axiom.passed}개 통과 · 다시 쓰게 하는 중`;
        },
      });

      const shown = showLoop(loop);
      showPost(shown);
      if (shown.body) {
        await pushHistory({
          id: String(startedAt),
          created_at: new Date().toISOString(),
          method_label: findMethod(activePack, input.method_id)?.label ?? '',
          topic: input.topic,
          titles: shown.titles,
          body: shown.body,
          passed: loop.final_axiom.passed,
          total: loop.final_axiom.total,
          needs_review: loop.needs_human_review,
          model: loop.model,
        } satisfies WrittenPost);
        await drawHistory();
      }
      say(shown.body ? '다 만들었어요. 아래에서 읽어 보고 [채우기로 보내기]를 눌러 주세요.' : '글을 만들지 못했어요.', shown.body ? 'ok' : 'bad');
    } catch (err) {
      say(errorText(err), 'bad');
    } finally {
      clearInterval(ticker);
      stopper = null;
      makeButton.disabled = false;
      stopButton.hidden = true;
    }
  }

  makeButton.addEventListener('click', () => void make());
  stopButton.addEventListener('click', () => stopper?.abort());

  promptButton.addEventListener('click', () =>
    guarded(promptButton, (m) => say(m, 'bad'), async () => {
      if (!pack) return;
      const input = readInput();
      const problems = checkInput(pack, input);
      if (problems.length > 0) {
        say(problems.join(' '), 'warn');
        return;
      }
      const prompt = buildFullPrompt(pack, input);
      await navigator.clipboard.writeText(prompt);
      say(`프롬프트를 복사했어요 (${num(prompt.length)}자). ChatGPT나 Claude 화면에 붙여넣어 직접 써도 돼요.`, 'ok');
    }),
  );

  // 만드는 중에 창을 닫으면 멈춘다. 닫기 전에 한 번 묻는다.
  window.addEventListener('beforeunload', (event) => {
    if (stopper) event.preventDefault();
  });

  const form = h('section', { class: 'card' },
    h('h2', null, '글쓰기'),
    h('p', { class: 'hint' }, '웹의 글 만들기와 같은 프롬프트로, 내 AI 키를 써서 만들어요.'),
    field('글쓰기 방식', methodSelect),
    field('주제', topic),
    field('메인 키워드', mainKeyword),
    field('서브 키워드', subKeywords),
    field('독자 단계', awareness),
    field('글을 읽는 사람', persona, '비워 두면 웹과 같은 기본값을 써요.'),
    field('글쓴이의 말투', authorPersona),
    h('label', { class: 'labeled' }, h('span', { class: 'label' }, '사실 자료'), facts, factsHint),
    h('div', { class: 'buttons' }, templateButton),
    h('details', { class: 'more' },
      h('summary', null, '자세히'),
      field('검색 의도', searchIntent),
      field('독자가 얻으려는 것', jtbd),
      field('글쓴이 소개', authorIdentity),
      field('소속', consultancy),
    ),
    h('label', { class: 'labeled' }, h('span', { class: 'label' }, '글을 만들 AI'), picker.element),
    h('div', { class: 'buttons' }, makeButton, stopButton, promptButton),
    status,
  );

  const root = h('div', { class: 'stack' }, needPack, form, resultBox, historyBox);

  async function reload(): Promise<void> {
    pack = await loadPack();
    needPack.hidden = !!pack;
    form.hidden = !pack;
    if (pack) drawMethods();
  }

  void (async () => {
    await reload();
    const savedForm = await loadWriteForm();
    for (const [key, el] of Object.entries(inputs)) {
      const value = savedForm[key];
      if (typeof value === 'string' && value) el.value = value;
    }
    if (pack) drawFactsHint();
    await drawHistory();
  })();
  onStoreChange(['pack'], () => void reload());

  return root;
}
