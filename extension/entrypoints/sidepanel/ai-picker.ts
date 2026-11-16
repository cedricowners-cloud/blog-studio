import type { LLMProvider } from '../../lib/llm/client';
import { PROVIDER_GUIDES } from '../../lib/llm/providers';
import { loadKeys, loadLastProvider, onStoreChange, readyAis, saveLastProvider, type ReadyAi } from '../../lib/store';
import { h, option } from './dom';

// 글을 만들 AI를 고르는 칸. 설정에서 키와 모델을 정한 AI만 보인다.

export interface AiPicker {
  element: HTMLElement;
  current(): ReadyAi | null;
  select(provider: LLMProvider | null): void;
  refresh(): Promise<void>;
}

export function createAiPicker(openSettings: () => void): AiPicker {
  const select = h('select', { class: 'field' });
  const empty = h('div', { class: 'notice' },
    h('p', { class: 'message warn' }, 'AI 키가 아직 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.'),
  );
  const goSettings = h('button', { type: 'button' }, '설정 열기');
  goSettings.addEventListener('click', openSettings);
  empty.append(h('div', { class: 'buttons' }, goSettings));

  const element = h('div', null, select, empty);
  let ready: ReadyAi[] = [];
  let wanted: LLMProvider | null = null;

  function draw(): void {
    select.replaceChildren(
      ...ready.map((ai) => option(ai.provider, `${PROVIDER_GUIDES[ai.provider].name} · ${ai.model}`, ai.provider === wanted)),
    );
    select.hidden = ready.length === 0;
    empty.hidden = ready.length > 0;
  }

  async function refresh(): Promise<void> {
    ready = readyAis(await loadKeys());
    if (!wanted) wanted = await loadLastProvider();
    if (!ready.some((ai) => ai.provider === wanted)) wanted = ready[0]?.provider ?? null;
    draw();
  }

  select.addEventListener('change', () => {
    wanted = select.value as LLMProvider;
    void saveLastProvider(wanted);
  });

  onStoreChange(['aiKeys'], () => void refresh());
  void refresh();

  return {
    element,
    current: () => ready.find((ai) => ai.provider === wanted) ?? null,
    select(provider) {
      if (provider && ready.some((ai) => ai.provider === provider)) {
        wanted = provider;
        draw();
      }
    },
    refresh,
  };
}
