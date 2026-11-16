// 화면 요소를 만드는 작은 도우미.
// 글자는 항상 글자로만 넣는다 (innerHTML 을 쓰지 않는다). 페이지에서 읽어 온 글자가 섞이기 때문이다.

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') el.className = value;
      else el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export type Tone = 'ok' | 'warn' | 'bad' | '';

/** 버튼을 누른 동안 잠그고, 오류가 나면 알려 준다. */
export async function guarded(
  button: HTMLButtonElement,
  onError: (message: string) => void,
  work: () => Promise<void>,
): Promise<void> {
  button.disabled = true;
  try {
    await work();
  } catch (err) {
    onError('실패했어요: ' + String(err instanceof Error ? err.message : err));
  } finally {
    button.disabled = false;
  }
}

/** 이름표가 붙은 입력 칸 */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'labeled' },
    h('span', { class: 'label' }, label),
    control,
    hint ? h('span', { class: 'hint small' }, hint) : null,
  );
}

export function setMessage(el: HTMLElement, text: string, tone: Tone = ''): void {
  el.textContent = text;
  el.className = 'message ' + tone;
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const el = h('option', { value }, label);
  el.selected = selected;
  return el;
}

/** 숫자를 1,234 처럼 적는다 */
export const num = (n: number): string => n.toLocaleString('ko-KR');

/** 몇 초인지 "1분 5초"처럼 적는다 */
export function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
