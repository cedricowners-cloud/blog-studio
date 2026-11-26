# 크롬 웹 스토어에 올리기

확장을 크롬 웹 스토어에 올릴 때 쓰는 준비물과 순서다.
가족만 쓸 것이라 **비공개**(정해 둔 구글 계정만 설치)로 올리는 것을 기준으로 적었다.

스토어 화면의 이름은 조금 다를 수 있다. 뜻이 같은 칸을 찾아 넣는다.
서버 주소와 웹 주소는 저장소에 적지 않는다. 이 글의 `<서버 주소>`는 `.env`의 `WXT_SUPABASE_URL`, `<웹 주소>`는 `WXT_WEB_URL`이다. 스토어에 적을 때는 진짜 주소로 바꾼다.
규칙은 2026-11-26에 공식 문서에서 확인했다 (developer.chrome.com/docs/webstore).

## 준비된 것

| 파일 | 쓰는 곳 |
|---|---|
| `dist/blog-studio-extension-<버전>-chrome.zip` | 올릴 패키지. `npm run build && npm run zip`으로 만든다 |
| `store/icon-128.png` | 스토어 아이콘 (128×128). 패키지 안의 아이콘과 같은 그림이다 |
| `store/screenshot-1.png` ~ `3.png` | 화면 사진 (1280×800). 한 장 이상 꼭 올려야 한다 |
| 이 파일 | 스토어의 칸에 붙여넣을 글 |
| 개인정보 처리방침 | `<웹 주소>/privacy` (웹의 `web/app/privacy/page.tsx`. 웹을 배포해야 열린다) |

그림은 `npm run store:assets`로 다시 만든다 (`scripts/store-assets.ts`). 화면이 바뀌면 다시 만든다.
화면 사진 속의 글과 숫자는 예시다. 진짜 검색 결과가 아니다.

## 직접 해야 하는 일

개발자 등록, 등록비 결제, 약관 동의, 제출은 올리는 사람이 자기 구글 계정으로 한다.

1. `https://chrome.google.com/webstore/devconsole`에 들어가 구글 계정으로 로그인한다.
2. 개발자로 등록한다. 약관에 동의하고 등록비를 한 번 낸다. 이때 적는 개발자 이메일은 나중에 바꿀 수 없다.
3. 계정 설정에서 연락처 이메일을 확인한다. 같은 곳의 **테스터 목록**에 가족의 구글 이메일을 적는다.
4. **새 항목**을 누르고 패키지(zip)를 올린다.
5. 아래의 글을 각 탭에 넣는다.
6. **검토를 위해 제출**을 누른다. 보통 며칠, 길면 몇 주 걸린다.
7. 통과하면 스토어 주소를 가족에게 보낸다. 가족은 테스터 목록에 적은 구글 계정으로 크롬에 로그인한 상태에서 설치한다.

새 버전을 낼 때는 `package.json`의 버전을 올리고, 패키지를 다시 만들어 같은 항목에 올린다. 새 버전도 심사를 받는다. 통과하면 설치한 사람의 크롬이 알아서 바꾼다.

## 스토어 등록정보 탭

**이름**과 **요약**은 패키지에서 읽어 온다 (`wxt.config.ts`).

- 이름: `blog_studio 도우미`
- 요약: `내 AI 키로 블로그 글을 만들고, 네이버 블로그 글쓰기 화면에 채웁니다. 발행은 직접 누릅니다.`
- 카테고리: 도구 (Tools)
- 언어: 한국어

**자세한 설명** (그대로 붙여넣는다):

```text
블로그 글의 초안을 AI로 만들고, 네이버 블로그 글쓰기 화면에 채워 주는 사이드 패널 도구입니다.

■ 할 수 있는 일
· 자료 찾기: 키워드가 한 달에 몇 번 검색되는지 보고, 관련 블로그 글과 뉴스의 제목을 찾아 참고 자료로 고릅니다.
· 글 만들기: 주제와 키워드를 적으면 내가 고른 AI(Gemini, GPT, Claude)가 초안을 씁니다. 내 AI 키를 쓰고, 키는 내 컴퓨터에만 저장합니다.
· 사진으로 리뷰 쓰기: 내가 찍은 제품 사진과 메모로 리뷰 글의 초안을 만듭니다.
· 내 말투: 내 블로그의 공개 글을 읽고 말투를 정리해서 초안에 반영합니다.
· 채우기: 만든 글을 네이버 블로그 글쓰기 화면에 넣습니다. 소제목, 인용구, 구분선, 표, 색 강조, 사진까지 넣습니다.
· 블로그용 카드: 소제목마다 요약 카드를 그려 사진 자리에 넣습니다.

■ 하지 않는 일
· 저장과 발행은 하지 않습니다. 발행 버튼은 직접 누릅니다.
· 댓글, 공감, 이웃 추가 같은 동작은 하지 않습니다.
· 광고나 사용 기록 수집 도구가 없습니다.

■ 쓰기 전에 알아 둘 것
· 만든 사람과 가족이 쓰려고 만든 도구입니다. 글 만들기는 허락받은 계정으로 로그인해야 쓸 수 있습니다.
· AI를 쓰려면 Gemini, OpenAI, Claude 중 하나의 API 키가 있어야 합니다. AI 사용료는 그 회사에 직접 냅니다.
· AI가 쓴 글에는 틀린 내용이 있을 수 있습니다. 발행하기 전에 꼭 읽고 고쳐 주세요.
```

**그림**: 스토어 아이콘에 `store/icon-128.png`, 스크린샷에 `store/screenshot-1.png` ~ `3.png`를 올린다. 작은 홍보 그림(440×280)은 없어도 된다.

## 개인 정보 보호 탭

심사하는 사람이 읽는 칸이라 영어로 적는다. 아래의 한국어는 뜻풀이다.

**단일 목적 (Single purpose)**

```text
Draft blog posts with an AI provider chosen by the user and fill the draft into the Naver Blog editor that the user has opened. Keyword and reference search, the writing-style summary and summary-card images all serve that one purpose. The extension never saves or publishes the post; the user does that by hand.
```

뜻: 사용자가 고른 AI로 블로그 글의 초안을 만들고, 열려 있는 네이버 글쓰기 화면에 채운다. 자료 찾기, 말투 정리, 카드는 모두 이 목적을 돕는다. 저장과 발행은 하지 않는다.

**권한을 쓰는 이유 (Permission justification)**

`sidePanel`

```text
The whole UI lives in Chrome's side panel so the user can work next to the Naver Blog editor. Clicking the toolbar icon opens the panel.
```

`storage`

```text
Keeps the user's settings, their own AI API keys, the sign-in session and recent drafts in chrome.storage.local so work continues after the panel is closed. Nothing is synced or uploaded from storage.
```

`scripting`

```text
When the user presses "채우기 (Fill)", the extension injects its packaged script editor-bridge.js into the open blog.naver.com editor tab to insert the title, body and images of the draft. For the optional writing-style feature it injects the packaged script naver-reader.js into a blog.naver.com tab to read the public posts of the user's own blog. Only files shipped inside the package are injected.
```

`activeTab`

```text
Lets the extension work with the tab the user is looking at when they click the toolbar icon, so it can confirm that this tab is the Naver Blog editor before filling it. Other tabs are not accessed.
```

호스트 권한 (Host permission)

```text
https://blog.naver.com/* : insert the draft into the Naver Blog editor on the user's request, and read public posts of the user's own blog for the writing-style feature.
https://generativelanguage.googleapis.com/*, https://api.openai.com/*, https://api.anthropic.com/* : call the AI provider the user selected, with the user's own API key, to generate the draft.
https://openapi.naver.com/*, https://api.searchad.naver.com/* : read-only Naver Search and Search Ad APIs, used to look up monthly search volume of keywords and titles of related posts and news.
<서버 주소>/* : the extension's own backend, used to sign in and to download prompt templates and shared settings for the signed-in account.
<웹 주소>/* : the extension's companion web app. After the user clicks the e-mail sign-in link, the extension reads the sign-in token from that tab's URL to finish signing in. Page content is not read.
```

**원격 코드 (Remote code)**: `No, I am not using remote code`를 고른다.
물어보면 이렇게 답한다:

```text
All JavaScript is inside the package. The extension downloads prompt templates (plain text in JSON) from its backend and uses them only as input text for AI requests. They are never executed as code.
```

**데이터 사용 (Data usage)**: 아래 세 가지만 고른다.

| 고를 항목 | 이유 |
|---|---|
| 개인 식별 정보 (Personally identifiable information) | 로그인에 이메일을 쓴다 |
| 인증 정보 (Authentication information) | 로그인할 때 비밀번호나 메일 코드를 보내고, AI 키를 이 컴퓨터에 저장한다 |
| 웹사이트 콘텐츠 (Website content) | 내 블로그의 글을 읽고, 글쓰기 화면에 글과 사진을 넣는다 |

건강, 금융·결제, 개인 통신, 위치, 웹 기록, 사용자 활동은 고르지 않는다.
아래의 확인 세 가지는 모두 표시한다 (정보를 팔지 않는다, 목적과 상관없는 곳에 쓰지 않는다, 신용 평가에 쓰지 않는다).

**개인정보 처리방침 주소**: `<웹 주소>/privacy`

## 배포 탭

- 공개 범위: **비공개 (Private)**. 계정 설정의 테스터 목록에 적은 구글 계정만 설치할 수 있다.
- 지역: 대한민국만 골라도 된다.
- 판매자인지 묻는 칸이 나오면: 돈을 받지 않고 가족끼리 쓰는 것이면 판매자가 아니라고 답한다. 직접 판단해서 고른다.

## 테스트 안내 탭 (Test instructions)

심사하는 사람은 허락 목록에 없어서 프롬프트를 받지 못한다. 그래서 로그인 없이 볼 수 있는 것을 알려 준다.

```text
This extension is a private tool for the developer's family. AI drafting needs (1) an account on the developer's allow-list and (2) the tester's own AI API key, so it cannot be exercised without them. The core function, filling the Naver Blog editor, can be tested without any account of ours:

1. Click the toolbar icon. The side panel opens.
2. Open the "채우기" (Fill) tab and press "시험 글 불러오기" (Load sample post). A sample title and body appear.
3. In a tab, open the Naver Blog editor (https://blog.naver.com/ → "글쓰기"; a Naver account is required).
4. Press "채우기" (Fill) in the side panel. The sample title and body are inserted into the editor, including headings, quotes and highlights.
5. The extension does not save or publish. "채우기 전으로 되돌리기" restores the editor.

The "설정" (Settings) tab shows sign-in and AI key entry. Without an allow-listed account, sign-in succeeds but prompt templates are not delivered; this is by design. A test account can be provided on request through the support e-mail.
```

## 심사에서 물을 수 있는 것

- **시험용 계정을 달라고 할 때**: 허락 목록에 넣은 계정은 가족이 함께 쓰는 네이버 키도 받는다. 심사용 계정에는 그 키가 가지 않게 서버의 규칙을 먼저 고친 뒤에 계정을 준다.
- **`activeTab`이 꼭 필요한지 물을 때**: 네이버 블로그 주소의 접근 권한이 따로 있어서, 빼도 될 가능성이 크다. 빼면 실제 네이버 화면에서 채우기를 다시 확인하고 올린다.
- **이름이나 설명을 고치라고 할 때**: `wxt.config.ts`에서 고치고 패키지를 다시 만든다.

## 올리기 전에 확인

- [ ] `npm run build && npm test`가 통과한다 (`tests/leak.test.ts`가 패키지에 프롬프트와 관리용 키가 없는지 본다).
- [ ] `<웹 주소>/privacy`가 로그인 없이 열린다.
- [ ] 패키지의 버전이 스토어에 있는 버전보다 높다.
- [ ] 가족의 구글 이메일을 테스터 목록에 적었다.
