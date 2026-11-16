import { browser } from 'wxt/browser';
import { getNaverTab, probeEditor } from '../../lib/editor/run';
import type { ProbeResult } from '../../lib/editor/types';
import { h, type Child } from './dom';

// 에디터 읽기 화면 (E1). 글쓰기 화면의 에디터를 읽기만 한다. 채우기가 안 될 때 원인을 찾는 데 쓴다.
// 페이지에서 읽어 온 글자는 글자로만 넣는다 (innerHTML 을 쓰지 않는다).

const REASONS: Record<string, string> = {
  'no-editor': '이 탭에서 에디터를 찾지 못했어요. 네이버 블로그 글쓰기 화면인지 확인해 주세요.',
  'no-getDocumentData': '에디터는 찾았지만 문서를 읽는 기능이 없어요. 네이버가 에디터를 바꿨을 수 있어요.',
};

function explain(reason: string | null): string {
  if (!reason) return '';
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith('read-failed')) return '문서를 읽다가 오류가 났어요: ' + reason.replace('read-failed: ', '');
  return reason;
}

const KEY_METHODS = ['getDocumentData', 'setDocumentData', 'setDocumentTitle'];

let lastTabUrl: string | null = null;
/** 마지막으로 읽은 결과. 모든 프레임의 것을 담고, 문서 전체(rawJson)는 뺀다. */
let lastResults: ProbeResult[] = [];

const VERSION = browser.runtime.getManifest().version;

const resultBox = h('div', null);
const statusLine = h('p', { class: 'message' });

function setStatus(text: string, tone: 'ok' | 'warn' | 'bad' | '' = ''): void {
  statusLine.textContent = text;
  statusLine.className = 'message ' + tone;
}

function row(label: string, value: Child): Child[] {
  return [h('dt', null, label), h('dd', null, value)];
}

function renderResult(results: ProbeResult[], tabUrl: string): void {
  resultBox.replaceChildren();
  const best = results[0];
  const draftPrompt = results.some((r) => r.draftPrompt);

  if (!best || !best.found) {
    // 찾지 못했을 때는 프레임마다 무엇이 보였는지 그대로 보여 준다. 원인을 짐작할 단서다.
    const frames = results.map((r) =>
      h('dl', { class: 'rows' },
        ...row('프레임', (r.isTop ? '(바깥) ' : '(안쪽) ') + r.href.slice(0, 90)),
        ...row('SmartEditor', r.diag.smartEditorType),
        ...row('에디터 모음', `${r.diag.editorsType} · ${r.diag.editorCount}개`),
        ...row('화면의 부품', `${r.renderedCount}개`),
        ...row('SmartEditor 칸', r.diag.smartEditorKeys.join(', ') || '(없음)'),
        ...row('관련 전역 이름', r.diag.globalsLikeEditor.join(', ') || '(없음)'),
        ...row('안쪽 프레임', r.diag.iframes.join(' | ') || '(없음)'),
      ),
    );
    resultBox.append(
      h('section', { class: 'card' },
        h('h2', null, '결과'),
        h('p', { class: 'message bad' }, explain(best ? best.reason : 'no-editor')),
        h('p', { class: 'hint' }, '확인한 프레임 ' + results.length + '개 · ' + tabUrl),
        h('p', { class: 'hint' }, '[결과 복사]를 눌러 대화창에 붙여 주시면 원인을 찾을 수 있어요.'),
      ),
      h('section', { class: 'card' }, h('h2', null, '진단'), ...frames),
    );
    return;
  }

  const hasMethod = (name: string) => best.methods.includes(name);
  const saveLike = best.methods.filter((m) => /save|temp|draft|autosave/i.test(m));

  const summary = h('dl', { class: 'rows' },
    ...row('에디터', h('span', { class: 'ok' }, '찾았어요')),
    ...row('에디터 버전', best.editorVersion ?? '알 수 없음'),
    ...row('제목', best.title || '(비어 있음)'),
    ...row('부품 수', `문서 ${best.componentCount}개 · 화면 ${best.renderedCount}개`),
    ...row('작성 중인 글 팝업', draftPrompt ? h('span', { class: 'warn' }, '떠 있어요') : '없어요'),
    ...row('문서 읽기', hasMethod('getDocumentData') ? h('span', { class: 'ok' }, '가능') : h('span', { class: 'bad' }, '불가')),
    ...row('문서 넣기', hasMethod('setDocumentData') ? h('span', { class: 'ok' }, '기능 있음') : h('span', { class: 'bad' }, '기능 없음')),
    ...row('제목 넣기', hasMethod('setDocumentTitle') ? h('span', { class: 'ok' }, '기능 있음') : h('span', { class: 'warn' }, '기능 없음')),
    ...row('저장 관련 기능', saveLike.length ? saveLike.join(', ') : '찾지 못함'),
  );
  if (best.reason) summary.append(...(row('문제', h('span', { class: 'bad' }, explain(best.reason))) as Node[]));

  const counts = new Map<string, number>();
  for (const c of best.components) {
    const key = c.layout ? `${c.ctype} · ${c.layout}` : c.ctype;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const countTable = h('table', null,
    h('thead', null, h('tr', null, h('th', null, '부품 종류 · 모양'), h('th', null, '개수'))),
    h('tbody', null,
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, n]) => h('tr', null, h('td', null, key), h('td', { class: 'num' }, String(n)))),
    ),
  );

  const listTable = h('table', null,
    h('thead', null,
      h('tr', null,
        h('th', null, '#'), h('th', null, '종류'), h('th', null, '모양'), h('th', null, '문단'),
        h('th', null, '글자 (앞부분)'), h('th', null, '꾸밈'),
      ),
    ),
    h('tbody', null,
      ...best.components.map((c) =>
        h('tr', null,
          h('td', { class: 'num' }, String(c.index + 1)),
          h('td', null, c.ctype),
          h('td', null, c.layout ?? ''),
          h('td', { class: 'num' }, c.paragraphCount ? String(c.paragraphCount) : ''),
          h('td', null, c.text),
          h('td', { class: 'mono' }, (c.styles ?? []).join(', ')),
        ),
      ),
    ),
  );

  // 문서 전체에서 찾은 꾸밈 값을 한데 모아 보여 준다. 굵게·크기·정렬이 읽혔는지 여기서 확인한다.
  const allStyles = new Map<string, number>();
  for (const c of best.components) {
    for (const s of c.styles ?? []) allStyles.set(s, (allStyles.get(s) ?? 0) + 1);
  }
  const styleTable = h('table', null,
    h('thead', null, h('tr', null, h('th', null, '꾸밈 값'), h('th', null, '쓰인 부품 수'))),
    h('tbody', null,
      ...[...allStyles.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, n]) => h('tr', null, h('td', { class: 'mono' }, key), h('td', { class: 'num' }, String(n)))),
    ),
  );

  resultBox.append(
    h('section', { class: 'card' }, h('h2', null, '에디터 상태'), summary),
    h('section', { class: 'card' }, h('h2', null, '부품 종류별 개수'), countTable),
    h('section', { class: 'card' },
      h('h2', null, `읽은 꾸밈 값 (${allStyles.size}가지)`),
      allStyles.size
        ? h('div', { class: 'scroll' }, styleTable)
        : h('p', { class: 'hint' }, '꾸밈 값을 찾지 못했어요. 굵게나 글자 크기를 넣었는데도 비어 있으면 알려 주세요.'),
    ),
    h('section', { class: 'card' },
      h('h2', null, `부품 목록 (${best.components.length}개 표시)`),
      h('div', { class: 'scroll' }, listTable),
    ),
    h('section', { class: 'card' },
      h('details', null,
        h('summary', null, `에디터 기능 이름 ${best.methods.length}개`),
        h('p', { class: 'mono' }, best.methods.join(', ')),
      ),
      h('details', null,
        h('summary', null, '문서 맨 위 칸 · 프레임'),
        h('p', { class: 'mono' }, '칸: ' + best.docKeys.join(', ')),
        h('p', { class: 'mono' }, '프레임: ' + best.href),
        h('p', { class: 'mono' }, '주요 기능: ' + KEY_METHODS.map((m) => `${m}=${hasMethod(m) ? '있음' : '없음'}`).join(', ')),
      ),
    ),
  );
}

const EMPTY_RESULT: ProbeResult = {
  href: '',
  isTop: true,
  found: false,
  reason: 'no-editor',
  editorKeys: [],
  methods: [],
  editorVersion: null,
  docKeys: [],
  title: '',
  componentCount: 0,
  components: [],
  renderedCount: 0,
  draftPrompt: false,
  rawJson: null,
  rawTooLarge: false,
  diag: {
    smartEditorType: '(읽지 못함)',
    smartEditorKeys: [],
    editorsType: '(읽지 못함)',
    editorCount: 0,
    globalsLikeEditor: [],
    iframes: [],
  },
};

async function readEditor(includeRaw: boolean): Promise<ProbeResult | null> {
  const tab = await getNaverTab();
  if (!tab) {
    lastTabUrl = null;
    lastResults = [];
    resultBox.replaceChildren();
    setStatus('지금 보고 있는 탭이 네이버 블로그가 아니에요. 글쓰기 화면을 연 탭에서 눌러 주세요.', 'warn');
    return null;
  }
  lastTabUrl = tab.url;
  const results = await probeEditor(tab.id, includeRaw);
  renderResult(results, tab.url);
  lastResults = results.map((r) => ({ ...r, rawJson: null }));
  // 에디터가 있는 프레임이 맨 앞에 온다. 하나도 없으면 "찾지 못함"으로 돌려준다.
  return results[0] ?? { ...EMPTY_RESULT, href: tab.url };
}

function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function guarded(button: HTMLButtonElement, work: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await work();
  } catch (err) {
    setStatus('실패했어요: ' + String(err instanceof Error ? err.message : err), 'bad');
  } finally {
    button.disabled = false;
  }
}

const readButton = h('button', { class: 'primary', type: 'button' }, '에디터 읽기');
const sampleButton = h('button', { type: 'button' }, '견본으로 저장');
const copyButton = h('button', { type: 'button' }, '결과 복사');

readButton.addEventListener('click', () =>
  guarded(readButton, async () => {
    setStatus('읽는 중이에요…');
    const best = await readEditor(false);
    if (best && best.found) setStatus(`읽었어요. 부품 ${best.componentCount}개.`, 'ok');
    else if (best) setStatus('에디터를 찾지 못했어요. 아래 진단을 [결과 복사]로 복사해 주세요.', 'bad');
  }),
);

sampleButton.addEventListener('click', () =>
  guarded(sampleButton, async () => {
    setStatus('문서 전체를 읽는 중이에요…');
    const best = await readEditor(true);
    if (!best || !best.found) {
      if (best) setStatus('에디터를 찾지 못해서 견본을 저장하지 못했어요.', 'bad');
      return;
    }
    if (best.rawTooLarge || !best.rawJson) {
      setStatus('문서가 너무 커서 견본으로 저장하지 못했어요. 이미지가 적은 글로 다시 해 주세요.', 'warn');
      return;
    }
    const sample = {
      savedAt: new Date().toISOString(),
      editorVersion: best.editorVersion,
      frame: best.href,
      methods: best.methods,
      document: JSON.parse(best.rawJson),
    };
    await browser.storage.local.set({ editorSample: sample });
    const name = `editor-sample-${fileStamp()}.json`;
    downloadText(name, JSON.stringify(sample, null, 2));
    setStatus(`견본을 저장했어요. 다운로드 폴더에 ${name} 파일도 만들었어요.`, 'ok');
  }),
);

copyButton.addEventListener('click', () =>
  guarded(copyButton, async () => {
    if (!lastTabUrl) {
      setStatus('먼저 [에디터 읽기]를 눌러 주세요.', 'warn');
      return;
    }
    const report = { extensionVersion: VERSION, tabUrl: lastTabUrl, frames: lastResults };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setStatus('결과를 복사했어요. 대화창에 붙여넣으면 돼요.', 'ok');
  }),
);

export function createReaderSection(): HTMLElement {
  setStatus('');
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', null, '에디터 읽기 (점검용)'),
      h('p', { class: 'hint' },
        '채우기가 안 될 때 쓰는 점검 도구예요. 네이버 블로그 글쓰기 화면을 연 탭에서 눌러 주세요. 읽기만 하고, 글을 바꾸거나 저장하지 않아요.',
      ),
      h('div', { class: 'buttons' }, readButton, sampleButton, copyButton),
      statusLine,
    ),
    resultBox,
  );
}
