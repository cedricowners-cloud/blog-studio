import { browser } from 'wxt/browser';
import { h } from './dom';
import { createFillSection } from './fill-section';
import { createReaderSection } from './reader-section';
import { createSeoSection } from './seo-section';
import { createSettingsSection } from './settings-section';
import { createVoiceSection } from './voice-section';
import { createWriteSection } from './write-section';

// 사이드 패널 화면. 탭 다섯 개로 나뉜다.
//   글쓰기      글쓰기 방식 6개로 글 만들기 (write-section.ts)
//   SEO 8단계   프롬프트 8개를 차례로 돌려 글 만들기 (seo-section.ts)
//   채우기      만든 글을 네이버 글쓰기 화면에 넣기 (fill-section.ts), 에디터 점검 (reader-section.ts)
//   내 말투     내 글 모으기, 말투 카드 (voice-section.ts)
//   설정        프롬프트 묶음, AI 키 (settings-section.ts)

type TabId = 'write' | 'seo' | 'fill' | 'voice' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'write', label: '글쓰기' },
  { id: 'seo', label: 'SEO 8단계' },
  { id: 'fill', label: '채우기' },
  { id: 'voice', label: '내 말투' },
  { id: 'settings', label: '설정' },
];

const TAB_MEMORY = 'blogStudioTab';

const app = document.getElementById('app') as HTMLElement;
const stage = document.querySelector('.stage');
if (stage) stage.textContent = `시험판 · 버전 ${browser.runtime.getManifest().version}`;

const buttons = new Map<TabId, HTMLButtonElement>();
const panels = new Map<TabId, HTMLElement>();

function show(id: TabId): void {
  for (const tab of TABS) {
    const active = tab.id === id;
    buttons.get(tab.id)?.classList.toggle('active', active);
    const panel = panels.get(tab.id);
    if (panel) panel.hidden = !active;
  }
  try {
    localStorage.setItem(TAB_MEMORY, id);
  } catch {
    // 기억하지 못해도 쓰는 데는 문제없다
  }
  window.scrollTo({ top: 0 });
}

const openSettings = () => show('settings');

const fill = createFillSection();
const sendToFill = (title: string, body: string) => {
  fill.setContent(title, body);
  show('fill');
};

panels.set('write', createWriteSection({ sendToFill, openSettings }));
panels.set('seo', createSeoSection({ sendToFill, openSettings }));
panels.set('fill', h('div', { class: 'stack' }, fill.element, createReaderSection()));
panels.set('voice', createVoiceSection({ openSettings }));
panels.set('settings', createSettingsSection());

const tabBar = h('nav', { class: 'tabs' },
  ...TABS.map((tab) => {
    const button = h('button', { type: 'button', class: 'tab' }, tab.label);
    button.addEventListener('click', () => show(tab.id));
    buttons.set(tab.id, button);
    return button;
  }),
);

app.append(tabBar, ...TABS.map((tab) => panels.get(tab.id) as HTMLElement));

let remembered: string | null = null;
try {
  remembered = localStorage.getItem(TAB_MEMORY);
} catch {
  remembered = null;
}
show(TABS.some((tab) => tab.id === remembered) ? (remembered as TabId) : 'write');
