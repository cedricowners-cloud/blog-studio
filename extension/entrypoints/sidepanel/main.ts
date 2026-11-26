import { browser } from 'wxt/browser';
import { refreshStaleModels, upgradeDefaults } from '../../lib/llm/refresh';
import { h } from './dom';
import { createFillSection } from './fill-section';
import type { PreparedImage } from '../../lib/editor/image-file';
import { createReaderSection } from './reader-section';
import { createResearchSection } from './research-section';
import { createReviewSection } from './review-section';
import { createSeoSection } from './seo-section';
import { createSettingsSection } from './settings-section';
import { createVoiceSection } from './voice-section';
import { createWriteSection } from './write-section';

// 사이드 패널 화면. 탭 일곱 개로 나뉜다.
//   자료        네이버에서 키워드의 검색 수, 블로그 글, 뉴스 찾기 (research-section.ts)
//   글쓰기      글쓰기 방식 6개로 글 만들기 (write-section.ts)
//   사진 리뷰   내가 찍은 제품 사진과 메모로 리뷰 글 만들기 (review-section.ts)
//   SEO 8단계   프롬프트 8개를 차례로 돌려 글 만들기 (seo-section.ts)
//   채우기      만든 글을 네이버 글쓰기 화면에 넣기 (fill-section.ts), 에디터 점검 (reader-section.ts)
//   내 말투     내 글 모으기, 말투 카드 (voice-section.ts)
//   설정        프롬프트 묶음, AI 키 (settings-section.ts)

type TabId = 'research' | 'write' | 'review' | 'seo' | 'fill' | 'voice' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'research', label: '자료' },
  { id: 'write', label: '글쓰기' },
  { id: 'review', label: '사진 리뷰' },
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

const fill = createFillSection({ openSettings });
const sendToFill = (title: string, body: string, images?: Map<string, PreparedImage>) => {
  fill.setContent(title, body, images);
  show('fill');
};

const openWrite = () => show('write');
const openResearch = () => show('research');

panels.set('research', createResearchSection({ openSettings, openWrite }));
panels.set('write', createWriteSection({ sendToFill, openSettings, openResearch }));
panels.set('review', createReviewSection({ sendToFill, openSettings }));
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

// 탭 줄의 높이를 알려 둔다. 자료 탭 안의 작은 탭이 이 줄 바로 아래에 붙어 있게 하는 데 쓴다.
// 패널이 좁아서 탭이 두 줄이 되면 높이가 달라지므로, 바뀔 때마다 다시 잰다.
const noteTabsHeight = () => document.documentElement.style.setProperty('--tabs-h', `${tabBar.offsetHeight}px`);
new ResizeObserver(noteTabsHeight).observe(tabBar);
noteTabsHeight();

let remembered: string | null = null;
try {
  remembered = localStorage.getItem(TAB_MEMORY);
} catch {
  remembered = null;
}
show(TABS.some((tab) => tab.id === remembered) ? (remembered as TabId) : 'write');

// 추천 모델이 바뀌었으면, 전에 자동으로 골라진 모델을 새 추천으로 한 번 옮겨 준다.
// 그다음 받은 지 오래된 모델 목록을 새로 받는다 (새 모델이 보이고, 꺼진 모델은 빠진다). 둘 다 돈이 들지 않는다.
void upgradeDefaults()
  .catch(() => [])
  .then(() => refreshStaleModels())
  .catch(() => undefined);
