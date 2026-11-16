import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';

// 확장 아이콘을 누르면 사이드 패널이 열리게 한다. 저장소는 확장의 화면에서만 읽게 한다.
export default defineBackground(() => {
  const openPanelOnClick = () =>
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err: unknown) => console.error('사이드 패널 설정 실패:', err));

  // AI 키가 든 저장소를 확장의 화면에서만 읽게 한다. 웹페이지에 넣는 스크립트는 읽지 못한다.
  browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((err: unknown) => console.error('저장소 접근 설정 실패:', err));

  browser.runtime.onInstalled.addListener(openPanelOnClick);
  browser.runtime.onStartup.addListener(openPanelOnClick);
  openPanelOnClick();
});
