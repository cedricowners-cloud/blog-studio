# 네이버 에디터에서 직접 확인한 것

확장의 [에디터 읽기]로 실제 글쓰기 화면을 읽어서 확인한 내용만 적는다.
네이버가 공개한 기능이 아니라서 언제든 바뀔 수 있다. 바뀌면 이 문서부터 고친다.

## 2026-11-16 확인 (에디터 버전 1.78.1)

### 에디터가 있는 곳
- 글쓰기 화면 주소는 `blog.naver.com/<블로그ID>/postwrite` 모양이다.
- 에디터는 맨 바깥 화면이 아니라 **안쪽 프레임**에 있다. 그래서 모든 프레임에 코드를 넣어야 찾는다.
- `window.SmartEditor`는 일반 객체가 아니라 **함수(클래스)**다. 종류를 따지면 못 찾는다.
- `SmartEditor._editors`는 객체이고 에디터가 1개 들어 있다. 이름은 `blogpc001`이었다.
- `SmartEditor`에는 `getEditor`, `launch`, `destroy`, `Config`, `COMMAND`, `PLUGIN`, `OPTION` 같은 칸도 있다.
- 에디터 프레임 안에 `input_buffer…`라는 주소 없는 프레임이 있다. 붙여넣기를 받는 곳으로 보인다.

### 문서의 모양
- 맨 위 칸: `version`, `theme`, `language`, `id`, `components`, `di`
- 본문은 `components` 배열에 부품이 순서대로 들어 있다.

| 부품 종류 | 가진 칸 | 확인한 모양(layout) |
|---|---|---|
| `documentTitle` (제목) | `id`, `layout`, `title`, `subTitle`, `align` | `default` |
| `text` (문단 묶음) | `id`, `layout`, `value` | `default` |
| `quotation` (인용구) | `id`, `layout`, `value`, `source` | `default`, `quotation_line`, `quotation_bubble`, `quotation_postit`, `quotation_corner`, `quotation_underline` |
| `horizontalLine` (구분선) | `id`, `layout` | `default`, `line1`, `line2`, `line3`, `line4`, `line5`, `line6`, `line7` |

### 에디터가 가진 기능 (이름만 확인. 써 보지는 않았다)
- 읽기: `getDocumentData`, `getDocumentTitle`, `getComponentsByCtype`, `getComponentInfoList`, `getContentText`, `getTags`, `getTagsWithConstraints`, `getWordCountAsync`, `isEmptyDocumentContent`, `getFocusedComponent`
- 넣기: `setDocumentData`, `setDocumentTitle`, `insertCustomData`, `updateCustomData`, `execCommand`
- 그 밖: `focusFirstText`, `focusTitle`, `validate`, `validateAsync`, `pauseDocumentEdit`, `unpauseDocumentEdit`, `toastInfo`, `toastWarn`, `hideAllLayers`
- **저장하는 기능은 에디터에 없다.** 임시저장은 화면의 버튼으로만 할 수 있다.
- 태그는 읽는 기능(`getTags`)만 있고 넣는 기능은 보이지 않는다.

## 2026-11-16 견본으로 확인 (문서 형식 버전 2.10.2)

견본 원본은 `extension/fixtures/editor-sample-*.json`에 있다 (git에는 올리지 않는다).

### 바깥 모양
`getDocumentData()`는 `{ document, documentId }`를 돌려준다. `document` 안에 `version`, `theme`, `language`, `id`, `components`, `di`가 있다.

### 문단과 글자 조각
`text`, `quotation`, 표의 칸, 제목은 모두 **문단(paragraph)의 배열**을 가진다.

```
문단   { id, nodes: [글자 조각…], style?: { align, "@ctype": "paragraphStyle" }, "@ctype": "paragraph" }
글자   { id, value: "글", style?: { …꾸밈, "@ctype": "nodeStyle" }, "@ctype": "textNode" }
```

| 꾸밈 | 들어가는 곳 | 값 |
|---|---|---|
| 굵게 | 글자 조각의 `style.bold` | `true` |
| 기울임 | 글자 조각의 `style.italic` | `true` |
| 밑줄 | 글자 조각의 `style.underline` | `true` |
| 취소선 | 글자 조각의 `style.strikeThrough` | `true` |
| 글자 크기 | 글자 조각의 `style.fontSizeCode` | `"fs19"`, `"fs24"` (크기 숫자 앞에 fs) |
| 정렬 | **문단**의 `style.align` | `"center"`, `"right"` (왼쪽은 `style`이 없다) |

- 꾸밈이 없는 글자 조각에는 `style`이 아예 없다.
- 빈 줄은 `value`가 빈 글자 조각 하나를 가진 문단이다.
- `id`는 `SE-`로 시작하는 고유값이다. 부품, 문단, 글자 조각, 표의 칸에 있다. 표의 줄과 `style`에는 없다.

### 부품별 모양

```
제목     { id, layout: "default", title: [문단], subTitle: null, align: "left", "@ctype": "documentTitle" }
글       { id, layout: "default", value: [문단…], "@ctype": "text" }
인용구   { id, layout, value: [문단…], source: null, "@ctype": "quotation" }
구분선   { id, layout, "@ctype": "horizontalLine" }
표       { id, layout: "default", width: 100, rows: [줄…], columnCount, borderStyleName: "thinLine", "@ctype": "table" }
  줄     { cells: [칸…], "@ctype": "tableRow" }
  칸     { id, colSpan: 1, rowSpan: 1, width: 33.33, height: 43, value: [문단] 또는 null, "@ctype": "tableCell" }
```

- 연달아 쓴 문단은 하나의 `text` 부품에 같이 들어간다. 큰 글자 줄(소제목)도 마찬가지다.
- 표의 빈 칸은 `value`가 `null`이다. 칸 너비는 퍼센트다 (3칸이면 33.33).

### 이미지
```
{ id, layout: "default", align, src, internalResource: true, represent, path, domain, fileSize,
  width, widthPercentage, height, originalWidth, originalHeight, fileName, caption,
  format: "normal", displayFormat: "normal", imageLoaded, contentMode: "fit",
  origin: { srcFrom: "local", "@ctype": "imageOrigin" }, ai: false, "@ctype": "image" }
```
- `src`, `path`, `domain`은 네이버가 올린 뒤에 정해 주는 값이다. 직접 만들 수 없다. 사진은 붙여넣기로 올려야 한다.
- `represent`는 대표 이미지 여부다.
- **`ai` 칸이 있다.** AI로 만든 이미지인지 표시하는 값으로 보인다. 설계 문서의 "정해야 할 것 10번(AI 활용 설정)"과 이어진다.

## 2026-11-16 채우기 확인

- 확장으로 시험 글을 채웠고, 사용자가 화면에서 잘 들어간 것을 확인했다.
- 채운 뒤 [견본으로 저장]으로 받은 문서(`fixtures/editor-sample-20261116-1611.json`)가 우리가 넣은 것과 같은 구조였다. 제목, 글 3묶음, 인용구 3종, 구분선 3종, 표 1개가 순서대로 들어 있었다.
- 즉 `setDocumentData`는 `getDocumentData`가 돌려준 것과 같은 모양(`{ document, documentId }`)을 받는다.

## 글자색 (2026-11-16 확인함)

| 꾸밈 | 들어가는 곳 | 값 |
|---|---|---|
| 글자색 | 글자 조각의 `style.fontColor` | `"#1e3a8a"` 같은 6자리 색 값 |
| 형광펜(배경색) | 글자 조각의 `style.backgroundColor` | `"#fff3a3"` 같은 6자리 색 값 |

- 확장 0.2.0으로 시험 글을 채운 뒤 [견본으로 저장]으로 받은 문서(`fixtures/editor-sample-20261116-1619.json`)에 두 값이 넣은 그대로 남아 있었다.
- 이 문서의 본문 부품 26개는 확장이 넣은 것과 **칸 하나까지 같았다** (id만 다르다). 인용구 6종, 구분선 8종, 표, 색 3곳이 모두 들어 있었다.
- 이름은 처음에 다른 확장 프로그램이 쓰는 것을 참고했고, 내 에디터가 그 값을 버리지 않는다는 것까지 확인했다.
- **화면에도 색으로 보였다.** 사용자가 글쓰기 화면에서 긍정 강조, 부정 강조, 형광펜 세 줄이 색으로 나온 것을 확인했다.

## 아직 모르는 것

| 무엇 | 어떻게 확인하나 |
|---|---|
| 임시저장한 글을 다시 열어도 그대로인지 | 사용자가 시험이 잘 됐다고 했다. 다시 열어 본 것인지는 한 번 더 확인한다 |
| 넣은 뒤 되돌리기(Cmd+Z)가 되는지 | E2에서 확인한다 |
| 이미지의 `ai` 값을 화면에서 어떻게 켜는지 | 글쓰기 화면에서 확인한다 |

## 설계와 맞춰 볼 것

- 인용구: 설계의 1·2·3번을 `default`, `quotation_line`, `quotation_bubble`로 맞춘다. 에디터에는 3종이 더 있다.
- 구분선: 설계는 3종인데 에디터에는 8종이 있다. 어느 것을 1·2·3번으로 쓸지 화면을 보고 정한다.

## 사진 넣기 (2026-11-18, 확장 0.6.0. **아직 실제 화면에서 확인하지 못함**)

사진의 주소는 네이버가 사진을 받은 뒤에 정해 준다. 그래서 문서에 사진 부품을 직접 만들어 넣을 수 없다. 사진을 에디터에 붙여넣어 올린 다음, 생긴 사진 부품을 원하는 자리로 옮긴다.

아래는 다른 확장의 동작에서 알아낸 에디터의 성질이다 (코드는 가져오지 않았다). 내 에디터에서 직접 본 것이 아니므로, 처음 써 볼 때 확인해야 한다.

| 성질 | 내용 |
|---|---|
| 붙여넣기를 받는 곳 | 에디터 프레임 안의 숨은 입력 칸 `iframe[id^='input_buffer']`. 그 안의 `contenteditable` 요소(없으면 body)에 "붙여넣기" 사건을 보낸다 |
| 커서 | 붙여넣기는 커서가 있어야 받는다. 본문의 마지막 문단을 누른 것처럼 하고 커서를 끝에 둔다 |
| 다 올라갔는지 | 사진 부품의 `src`가 `http`로 시작하면 다 올라간 것이다. `imageLoaded`는 화면에 그려졌는지에 가까워서 믿지 않는다 |
| 붙여넣은 뒤의 문서 | 에디터가 커서 자리의 글 덩어리를 쪼개고 뒤쪽 문단의 꾸밈을 기본값으로 바꾼다. 그 문서를 그대로 쓰면 꾸밈이 사라진다 |
| 탭이 보여야 함 | 뒤로 밀린 탭은 붙여넣기를 처리하지 않는다 |
| 묶음 | 사진을 나란히 넣으면 `imageStrip` 부품이 되고, 사진은 그 안의 `images`에 들어간다 |
| 파일 이름 | 사진 부품의 `fileName`에 붙여넣은 파일의 이름이 남는다. 어느 사진인지 짝을 맞추는 데 쓴다 |

확장이 하는 순서 (`entrypoints/editor-bridge.ts`의 `imagesBegin` → `imagePaste` → `imagesFinish`):

1. 지금 문서를 떠 둔다 (글을 채운 직후의 문서. 이미지 자리가 "[이미지 자리: …]" 글자로 들어 있다).
2. 사진을 한 장씩 붙여넣는다. 에디터가 네이버에 올린다.
3. 다 올라오면, 떠 둔 문서의 이미지 자리 문단을 올라온 사진 부품으로 바꾼 문서를 만들어 다시 넣는다 (`lib/editor/images.ts`). 붙여넣느라 쪼개진 문서는 쓰지 않는다.
4. 한 장도 올라오지 않으면 떠 둔 문서로 돌려놓는다. 올라오지 않은 사진의 자리는 글자로 남긴다.

처음 써 볼 때 확인할 것:

| 무엇 | 어떻게 |
|---|---|
| 붙여넣기가 받아지는지 (`input_buffer`가 있는지) | 사진 한 장을 골라 채운다. "사진 넣기 기록"에 붙여넣기를 받은 곳이 나온다 |
| 사진이 자리에 들어가고 글의 꾸밈이 그대로인지 | 화면에서 본다 |
| 임시저장한 뒤 다시 열어도 사진이 그대로인지 | 저장하고 다시 연다 |
| 대표 사진(`represent`)이 첫 사진으로 잡히는지 | 발행 창에서 본다 |

