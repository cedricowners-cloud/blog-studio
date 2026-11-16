import { llmChat, resolveMaxTokens, type ChatMessage } from '../../lib/llm/client';
import type { PackSeoStep, PromptPack, SeoPlatform } from '../../lib/prompts/pack';
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
  type ChatFn,
  type SeoMode,
  type SeoRun,
} from '../../lib/seo/engine';
import { addUsage, deleteSeoRun, loadPack, loadSeoRuns, onStoreChange, saveSeoRun } from '../../lib/store';
import { createAiPicker } from './ai-picker';
import { errorText, field, h, num, option, seconds, setMessage, type Tone } from './dom';

// SEO 8단계 글쓰기 화면. 웹의 "SEO 글쓰기"와 같은 프롬프트 8개를 같은 순서로 돌린다.
// 다른 점: AI를 내 키로 직접 부르고, 진행 상황을 이 컴퓨터에 둔다.

export interface SeoDeps {
  sendToFill: (title: string, body: string) => void;
  openSettings: () => void;
}

/** 웹에서 쓰던 값. 모델의 한도를 모를 때 쓴다 */
const WEB_MAX_TOKENS = 8192;
const WANTED_MAX_TOKENS = 16000;

const MODE_LABELS: Record<SeoMode, string> = {
  api: 'AI와 바로 진행 (내 키 사용)',
  copy: '프롬프트를 복사해서 직접 진행 (ChatGPT, Claude 화면에 붙여넣기)',
};

export function createSeoSection(deps: SeoDeps): HTMLElement {
  const root = h('div', { class: 'stack' });
  const picker = createAiPicker(deps.openSettings);

  let pack: PromptPack | null = null;
  let runs: SeoRun[] = [];
  let current: SeoRun | null = null;
  /** 지금 보고 있는 단계 */
  let viewStepId: number | null = null;
  let stopper: AbortController | null = null;
  /** 직전 답이 길이 한도에 걸려 잘렸는지 */
  let lastTruncated = false;
  /** 다시 그려도 쓰던 글이 지워지지 않게 둔다 */
  let draft = '';

  const status = h('p', { class: 'message' });
  const say = (text: string, tone: Tone = '') => setMessage(status, text, tone);
  const now = () => new Date().toISOString();

  async function commit(next: SeoRun): Promise<void> {
    current = next;
    await saveSeoRun(next);
    runs = await loadSeoRuns();
  }

  /** 제목 단계의 결과에서 고를 수 있는 제목들 */
  function titleCandidates(run: SeoRun): string[] {
    if (!pack) return [];
    let found: string[] = [];
    for (const step of stepsOf(pack, run)) {
      const titles = extractTitles(run.results[step.id]?.final_output ?? '');
      if (titles.length > 0) found = titles;
    }
    return found;
  }

  function toFill(output: string): void {
    if (!current) return;
    let title = current.selected_title ?? titleCandidates(current)[0] ?? '';
    let body = output;
    const firstHeading = /^\s*#\s+(.+)\n/.exec(body);
    if (firstHeading) {
      if (!title) title = (firstHeading[1] ?? '').trim();
      body = body.slice(firstHeading[0].length);
    }
    deps.sendToFill(title, body.trim());
  }

  function chatNow(): ChatFn {
    return async (messages: ChatMessage[]) => {
      const ai = picker.current();
      if (!ai) throw new Error('AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.');
      const startedAt = Date.now();
      let chars = 0;
      let waiting = '';
      const draw = () =>
        say(`${waiting || (chars > 0 ? `받은 글 ${num(chars)}자` : 'AI가 생각하는 중')} · ${seconds(Date.now() - startedAt)} · 받는 동안 이 창을 닫지 마세요`);
      const ticker = setInterval(draw, 1000);
      draw();
      try {
        const result = await llmChat(messages, {
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
        if (!result.text.trim()) {
          throw new Error(result.stopReason === 'blocked' ? 'AI가 이 요청에 답하지 않았어요.' : 'AI가 빈 답을 보냈어요. 다시 해 주세요.');
        }
        lastTruncated = result.stopReason === 'length';
        return result.text;
      } finally {
        clearInterval(ticker);
      }
    };
  }

  /** AI를 부르는 일을 한다. 하는 동안 버튼을 잠그고, 끝나면 다시 그린다. */
  async function work(job: (run: SeoRun, chat: ChatFn) => Promise<SeoRun>, done: string): Promise<void> {
    if (!current || stopper) return;
    const run = current;
    stopper = new AbortController();
    lastTruncated = false;
    render();
    try {
      await commit(await job(run, chatNow()));
      draft = '';
      say(lastTruncated ? 'AI의 답이 길이 한도에 걸려 중간에 잘렸어요. "이어서 써 줘"라고 보내 보세요.' : done, lastTruncated ? 'warn' : 'ok');
    } catch (err) {
      say(errorText(err), 'bad');
    } finally {
      stopper = null;
      render();
    }
  }

  /** AI를 부르지 않는 일 */
  async function change(job: (run: SeoRun) => SeoRun, done = ''): Promise<void> {
    if (!current) return;
    try {
      await commit(job(current));
      if (done) say(done, 'ok');
    } catch (err) {
      say(errorText(err), 'bad');
    }
    render();
  }

  // ───────── 시작 화면 ─────────

  function renderStart(activePack: PromptPack): void {
    const keyword = h('input', { type: 'text', class: 'field', placeholder: '예: 법인 전환 절차' });
    const platform = h('select', { class: 'field' },
      ...(Object.entries(activePack.seo.platform_labels) as [SeoPlatform, string][]).map(([value, label]) => option(value, label, value === 'naver_blog')),
    );
    const mode = h('select', { class: 'field' }, option('api', MODE_LABELS.api, true), option('copy', MODE_LABELS.copy));
    const optional = h('input', { type: 'checkbox' });
    optional.checked = true;
    const optionalSteps = activePack.seo.steps.filter((s) => s.optional).map((s) => s.short_label);
    const aiRow = h('label', { class: 'labeled' }, h('span', { class: 'label' }, '쓸 AI'), picker.element);
    mode.addEventListener('change', () => {
      aiRow.hidden = mode.value !== 'api';
    });
    const startButton = h('button', { type: 'button', class: 'primary' }, '시작');

    startButton.addEventListener('click', () => {
      void (async () => {
        try {
          const chosenMode = mode.value as SeoMode;
          if (chosenMode === 'api' && !picker.current()) {
            say('AI 키가 없어요. 설정에서 키를 넣거나, 진행 방식을 "복사해서 직접 진행"으로 바꿔 주세요.', 'warn');
            return;
          }
          const run = createRun({
            id: `seo-${Date.now()}`,
            platform: platform.value as SeoPlatform,
            mode: chosenMode,
            main_keyword: keyword.value,
            llm_provider: picker.current()?.provider ?? null,
            include_optional: optional.checked,
            now: now(),
          });
          viewStepId = stepsOf(activePack, run)[0]?.id ?? null;
          draft = '';
          await commit(run);
          say('');
          render();
        } catch (err) {
          say(errorText(err), 'bad');
        }
      })();
    });

    root.append(
      h('section', { class: 'card' },
        h('h2', null, 'SEO 8단계 글쓰기'),
        h('p', { class: 'hint' }, '키워드 하나로 시작해서, 검색 의도 분석부터 제목까지 단계별로 글을 만들어요. 웹의 SEO 글쓰기와 같은 프롬프트예요.'),
        field('메인 키워드', keyword),
        field('어디에 올릴 글인가요', platform, '자체 도메인을 고르면 주소(URL) 단계가 하나 더 있어요.'),
        field('진행 방식', mode),
        aiRow,
        optionalSteps.length > 0
          ? h('label', { class: 'check' }, optional, h('span', null, `덤 단계 넣기 (${optionalSteps.join(', ')})`))
          : null,
        h('div', { class: 'buttons' }, startButton),
        status,
      ),
    );

    if (runs.length > 0) {
      root.append(
        h('section', { class: 'card' },
          h('h2', null, '하던 글 이어 하기'),
          h('p', { class: 'hint small' }, '진행 상황은 이 컴퓨터에만 저장돼요.'),
          h('ul', { class: 'plain' },
            ...runs.map((run) => {
              const steps = stepsOf(activePack, run);
              const doneCount = steps.filter((s) => run.results[s.id]?.completed_at).length;
              const open = h('button', { type: 'button', class: 'link' }, run.main_keyword);
              open.addEventListener('click', () => {
                current = run;
                viewStepId = steps[Math.min(run.current_step_index, steps.length - 1)]?.id ?? null;
                draft = '';
                picker.select(run.llm_provider);
                say('');
                render();
              });
              const remove = h('button', { type: 'button', class: 'link muted' }, '지우기');
              remove.addEventListener('click', () => {
                void deleteSeoRun(run.id).then(reload);
              });
              return h('li', null,
                open,
                h('span', { class: 'hint small' },
                  ` · ${run.status === 'completed' ? '끝남' : `${doneCount}/${steps.length}단계`} · ${run.updated_at.slice(5, 10)} · ${run.mode === 'api' ? 'AI와 진행' : '복사 방식'} · `,
                ),
                remove,
              );
            }),
          ),
        ),
      );
    }
  }

  // ───────── 진행 화면 ─────────

  function titlePicker(run: SeoRun): HTMLElement | null {
    const candidates = titleCandidates(run);
    if (candidates.length === 0 && !run.selected_title) return null;
    const input = h('input', { type: 'text', class: 'field', placeholder: '제목을 직접 적어도 돼요' });
    input.value = run.selected_title ?? candidates[0] ?? '';
    const save = h('button', { type: 'button' }, '이 제목으로 정하기');
    save.addEventListener('click', () => void change((r) => selectTitle(r, input.value, now()), '제목을 정했어요.'));
    return h('div', { class: 'notice' },
      h('p', { class: 'label' }, run.selected_title ? `정한 제목: ${run.selected_title}` : '제목 고르기'),
      h('div', { class: 'choices' },
        ...candidates.map((t) => {
          const radio = h('input', { type: 'radio', name: 'seo-title' });
          radio.checked = t === input.value;
          radio.addEventListener('change', () => {
            input.value = t;
          });
          return h('label', { class: 'choice' }, radio, h('span', null, t));
        }),
      ),
      input,
      h('div', { class: 'buttons' }, save),
    );
  }

  function outputTools(output: string): HTMLElement {
    const copy = h('button', { type: 'button' }, '결과 복사');
    const fill = h('button', { type: 'button' }, '채우기로 보내기');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(output).then(
        () => say('결과를 복사했어요.', 'ok'),
        (err) => say(errorText(err), 'bad'),
      );
    });
    fill.addEventListener('click', () => toFill(output));
    return h('div', { class: 'buttons' }, copy, fill);
  }

  function renderStep(activePack: PromptPack, shownRun: SeoRun, step: PackSeoStep, steps: PackSeoStep[]): HTMLElement {
    // 제목이 필요한 단계인데 아직 고르지 않았으면, 웹처럼 첫 번째 제목을 기본으로 정해 둔다. 바꿀 수 있다.
    let run = shownRun;
    if (step.needs_selected_title && !run.selected_title) {
      const first = titleCandidates(run)[0];
      if (first) {
        run = selectTitle(run, first, now());
        current = run;
        void saveSeoRun(run);
      }
    }
    const result = resultOf(run, step.id);
    const busy = stopper !== null;
    const isLast = steps[steps.length - 1]?.id === step.id;
    const done = !!result.completed_at;
    const card = h('section', { class: 'card' },
      h('h2', null, `${steps.findIndex((s) => s.id === step.id) + 1}단계 · ${step.title}`),
    );

    // 제목이 필요한 단계, 또는 제목이 나온 단계에서는 제목을 고르게 한다.
    const hasTitles = extractTitles(result.final_output ?? '').length > 0;
    if (step.needs_selected_title || hasTitles) {
      const pickerBox = titlePicker(run);
      if (pickerBox) card.append(pickerBox);
      else if (step.needs_selected_title) card.append(h('p', { class: 'message warn' }, '앞의 제목 단계를 먼저 끝내 주세요.'));
    }

    if (run.mode === 'copy') {
      let prompt = '';
      try {
        prompt = initialMessageFor(activePack, run, step.id);
      } catch (err) {
        card.append(h('p', { class: 'message warn' }, errorText(err)));
      }
      if (prompt) {
        const promptArea = h('textarea', { class: 'field prose', rows: '6', readonly: 'readonly' });
        promptArea.value = prompt;
        const copyPrompt = h('button', { type: 'button', class: 'primary' }, '프롬프트 복사');
        copyPrompt.addEventListener('click', () => {
          void navigator.clipboard.writeText(prompt).then(
            () => say(`프롬프트를 복사했어요 (${num(prompt.length)}자). AI 화면에 붙여넣고, 받은 답을 아래에 붙여넣어 주세요.`, 'ok'),
            (err) => say(errorText(err), 'bad'),
          );
        });
        const pasteArea = h('textarea', { class: 'field prose tall', rows: '8', placeholder: 'AI에게 받은 답을 여기에 붙여넣어요' });
        pasteArea.value = draft || result.user_pasted_result || '';
        pasteArea.addEventListener('input', () => {
          draft = pasteArea.value;
        });
        const savePaste = h('button', { type: 'button' }, '결과 저장');
        savePaste.addEventListener('click', () => {
          const text = pasteArea.value;
          draft = '';
          void change((r) => pasteResult(activePack, r, step.id, text, now()), '결과를 저장했어요.');
        });
        if (step.has_user_turn) {
          card.append(h('p', { class: 'hint small' }, '이 단계는 AI가 되묻는 단계예요. AI 화면에서 끝까지 주고받은 뒤, 마지막 답을 붙여넣어 주세요.'));
        }
        card.append(
          promptArea,
          h('div', { class: 'buttons' }, copyPrompt),
          pasteArea,
          h('div', { class: 'buttons' }, savePaste),
        );
      }
    } else if (result.conversation.length === 0) {
      const start = h('button', { type: 'button', class: 'primary' }, '이 단계 시작');
      start.disabled = busy;
      start.addEventListener('click', () => void work((r, chat) => startStep(activePack, r, step.id, chat, now()), 'AI의 답이 왔어요.'));
      if (step.has_user_turn) card.append(h('p', { class: 'hint small' }, '이 단계는 AI가 되물어요. 답을 보내면서 진행해요.'));
      card.append(h('div', { class: 'buttons' }, start));
    } else {
      const [first, ...rest] = result.conversation;
      card.append(
        h('details', null, h('summary', null, '보낸 프롬프트 보기'), h('pre', { class: 'output' }, first?.content ?? '')),
        ...rest.map((m) => h('div', { class: 'bubble ' + m.role }, h('span', { class: 'who' }, m.role === 'assistant' ? 'AI' : '나'), h('pre', { class: 'output' }, m.content))),
      );
      if (!done) {
        const reply = h('textarea', { class: 'field prose', rows: '3', placeholder: step.has_user_turn ? 'AI의 질문에 답을 적어요' : '고치고 싶은 점이 있으면 적어요 (없으면 다음 단계로)' });
        reply.value = draft;
        reply.addEventListener('input', () => {
          draft = reply.value;
        });
        const send = h('button', { type: 'button' }, '보내기');
        send.disabled = busy;
        send.addEventListener('click', () => {
          const text = reply.value;
          void work((r, chat) => sendMessage(activePack, r, step.id, text, chat, now()), 'AI의 답이 왔어요.');
        });
        card.append(reply, h('div', { class: 'buttons' }, send));
      }
    }

    const output =
      run.mode === 'api'
        ? ([...result.conversation].reverse().find((m) => m.role === 'assistant')?.content ?? result.final_output)
        : result.final_output;

    if (output) card.append(outputTools(output));

    const controls = h('div', { class: 'buttons' });
    if (!done) {
      const next = h('button', { type: 'button', class: 'primary' }, isLast ? '끝내기' : '이 단계 끝내고 다음으로');
      next.disabled = busy || !output;
      next.addEventListener('click', () => {
        void (async () => {
          await change((r) => advance(activePack, r, step.id, now()), isLast ? '모든 단계를 끝냈어요.' : '');
          if (current && !isLast) {
            viewStepId = stepsOf(activePack, current)[current.current_step_index]?.id ?? viewStepId;
            draft = '';
            render();
          }
        })();
      });
      controls.append(next);
    }
    if (result.conversation.length > 0 || result.final_output) {
      const redo = h('button', { type: 'button' }, '이 단계 다시 하기');
      redo.disabled = busy;
      redo.addEventListener('click', () => {
        draft = '';
        void change((r) => resetStep(r, step.id, now()), '이 단계를 비웠어요. 다시 시작해 주세요.');
      });
      controls.append(redo);
    }
    if (busy) {
      const stop = h('button', { type: 'button' }, '멈추기');
      stop.addEventListener('click', () => stopper?.abort());
      controls.append(stop);
    }
    card.append(controls, status);
    return card;
  }

  function renderRun(activePack: PromptPack, run: SeoRun): void {
    const steps = stepsOf(activePack, run);
    const shown = steps.find((s) => s.id === viewStepId) ?? steps[Math.min(run.current_step_index, steps.length - 1)];
    const back = h('button', { type: 'button', class: 'link' }, '← 목록으로');
    back.addEventListener('click', () => {
      if (stopper) return;
      current = null;
      say('');
      render();
    });

    const chips = h('div', { class: 'chips' },
      ...steps.map((step, i) => {
        const result = run.results[step.id];
        const state = result?.completed_at ? 'done' : i === run.current_step_index && run.status !== 'completed' ? 'now' : '';
        const reachable = !!result || i <= run.current_step_index;
        const chip = h('button', { type: 'button', class: `chip ${state} ${shown?.id === step.id ? 'shown' : ''}` }, `${i + 1}. ${step.short_label}`);
        chip.disabled = !reachable || stopper !== null;
        chip.addEventListener('click', () => {
          viewStepId = step.id;
          draft = '';
          render();
        });
        return chip;
      }),
    );

    root.append(
      h('section', { class: 'card' },
        back,
        h('h2', null, `SEO 글쓰기 · ${run.main_keyword}`),
        h('p', { class: 'hint small' }, `${activePack.seo.platform_labels[run.platform]} · ${run.mode === 'api' ? 'AI와 바로 진행' : '복사해서 직접 진행'}`),
        run.mode === 'api' ? h('label', { class: 'labeled' }, h('span', { class: 'label' }, '쓸 AI'), picker.element) : null,
        chips,
        run.status === 'completed'
          ? h('p', { class: 'message ok' }, '모든 단계가 끝났어요. 본문이 있는 단계를 눌러 [채우기로 보내기]를 눌러 주세요.')
          : null,
        h('p', { class: 'hint small' }, 'AI가 적어 준 출처와 숫자는 실제와 다를 수 있어요. 올리기 전에 직접 확인해 주세요.'),
      ),
    );
    if (shown) root.append(renderStep(activePack, run, shown, steps));
  }

  function render(): void {
    root.replaceChildren();
    if (!pack) {
      const toSettings = h('button', { type: 'button', class: 'primary' }, '설정 열기');
      toSettings.addEventListener('click', deps.openSettings);
      root.append(
        h('section', { class: 'card' },
          h('h2', null, 'SEO 8단계 글쓰기'),
          h('p', { class: 'message warn' }, '프롬프트 묶음을 아직 불러오지 않았어요. 설정에서 먼저 불러와 주세요.'),
          h('div', { class: 'buttons' }, toSettings),
        ),
      );
      return;
    }
    if (current) renderRun(pack, current);
    else renderStart(pack);
  }

  async function reload(): Promise<void> {
    pack = await loadPack();
    runs = await loadSeoRuns();
    if (!stopper) render();
  }

  window.addEventListener('beforeunload', (event) => {
    if (stopper) event.preventDefault();
  });
  onStoreChange(['pack'], () => void reload());
  void reload();

  return root;
}
