import { browser } from 'wxt/browser';

// 카드에 쓰는 글씨체(Pretendard). 확장에 넣어 둔 파일(public/fonts)에서 불러온다.
// 어느 컴퓨터에서나 카드가 같은 모양으로 나오게 하려는 것이다. 인터넷에서 받아 오지 않는다.
// Pretendard 는 누구나 쓸 수 있는 글씨체다 (SIL Open Font License 1.1, public/fonts/Pretendard-LICENSE.txt).
// 굵기가 하나의 파일에 다 들어 있는 파일(가변 글꼴)을 쓴다.

let loading: Promise<boolean> | null = null;

/** 글씨체를 불러온다. 한 번만 불러오고, 실패하면 컴퓨터의 글씨체로 그린다 (false 를 돌려준다) */
export function loadCardFont(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const url = browser.runtime.getURL('/fonts/PretendardVariable.woff2');
      const face = new FontFace('Pretendard', `url("${url}")`, { weight: '45 920' });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  return loading;
}
