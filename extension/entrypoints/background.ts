import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { WEB_URL } from '../lib/server/config';
import { completeLoginFromUrl, syncPack, syncSharedKeys } from '../lib/server/session';

// 배경에서 도는 코드.
//   - 확장 아이콘을 누르면 사이드 패널이 열리게 한다.
//   - 저장소는 확장의 화면에서만 읽게 한다.
//   - 메일의 로그인 링크를 눌렀을 때, 도착한 탭의 주소에서 로그인 정보를 받아 확장에 로그인한다.
export default defineBackground(() => {
  const openPanelOnClick = () =>
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err: unknown) => console.error('사이드 패널 설정 실패:', err));

  // AI 키와 로그인 정보가 든 저장소를 확장의 화면에서만 읽게 한다. 웹페이지에 넣는 스크립트는 읽지 못한다.
  browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((err: unknown) => console.error('저장소 접근 설정 실패:', err));

  browser.runtime.onInstalled.addListener(openPanelOnClick);
  browser.runtime.onStartup.addListener(openPanelOnClick);
  openPanelOnClick();

  // 메일의 로그인 링크를 누르면 서버가 로그인 정보를 주소 뒤(#)에 붙여 blog_studio 웹으로 보낸다.
  // 그 탭의 주소가 보이면 로그인 정보를 받아 간다. 확장에서 로그인 메일을 요청하고 기다리는 중일 때만 한다
  // (completeLoginFromUrl 이 확인한다). 웹에 로그인하려고 누른 링크는 건드리지 않는다.
  const handling = new Set<string>();
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const url = changeInfo.url;
    if (!WEB_URL || !url || !url.startsWith(WEB_URL + '/')) return;
    if (!url.includes('access_token=') && !url.includes('error_code=')) return;
    if (handling.has(url)) return;
    handling.add(url);
    void (async () => {
      try {
        const result = await completeLoginFromUrl(url);
        if (result !== 'ok') return;
        // 로그인 정보가 든 주소를 화면에서 치우고, 로그인됐다고 알려 준다.
        await browser.tabs.update(tabId, { url: browser.runtime.getURL('/login-done.html') });
        await syncPack().catch((err: unknown) => console.error('프롬프트 받기 실패:', err));
        // 가족이 함께 쓰는 네이버 키도 받는다. 실패해도 로그인은 된 것이다.
        await syncSharedKeys().catch((err: unknown) => console.error('공용 키 받기 실패:', err));
      } catch (err) {
        console.error('링크로 로그인 실패:', err);
      } finally {
        handling.delete(url);
      }
    })();
  });
});
