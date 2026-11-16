// 에디터를 읽은 결과. 페이지에서 확장으로 넘어오므로 전부 JSON 으로 표현할 수 있는 값이다.

export interface ComponentSummary {
  /** 본문에서 몇 번째 부품인지 (0부터) */
  index: number;
  /** 부품 종류. 예: documentTitle, text, quotation, horizontalLine, table, image */
  ctype: string;
  /** 부품의 모양 이름. 인용구·구분선의 종류가 여기 들어 있다 */
  layout: string | null;
  /** 부품이 가진 칸 이름들 */
  keys: string[];
  /** 안에 든 글자 앞부분 */
  text: string;
  /** 안에 든 문단 수 (문단이 없는 부품은 0) */
  paragraphCount: number;
  /** 안에서 찾은 꾸밈 값들. "이름=값" 모양. 예: bold=true, fontSizeCode=fs24, align=center */
  styles: string[];
}

/** 에디터에 글을 넣어 달라는 요청 */
export interface FillRequest {
  /** 제목. null 이면 제목은 건드리지 않는다 */
  title: string | null;
  /** 넣을 부품들 (id 없음). `lib/editor/build.ts`가 만든다 */
  components: Record<string, unknown>[];
  /** 이미 글이 있어도 덮어쓸지 */
  force: boolean;
}

export interface FillMismatch {
  /** 본문에서 몇 번째 부품인지 (0부터) */
  index: number;
  expected: string;
  actual: string;
}

/** 글을 넣은 결과 */
export interface FillResult {
  ok: boolean;
  /** 실패한 이유. 성공이면 null */
  reason: string | null;
  /** 넣기 전에 있던 본문 부품 수와 글자 수 */
  existingCount: number;
  existingChars: number;
  /** 넣은 부품 수, 넣은 뒤 다시 읽은 부품 수 */
  sentCount: number;
  foundCount: number;
  /** 지우지 않고 남겨 둔 특수 부품 수 (지도, 스티커 등) */
  kept: number;
  /** 넣은 뒤의 제목 */
  titleAfter: string;
  /** 넣은 것과 다시 읽은 것이 다른 곳 */
  mismatches: FillMismatch[];
  /** 되돌릴 수 있는 사본이 있는지 */
  hasBackup: boolean;
}

/** 에디터를 찾지 못했을 때 원인을 짐작하기 위한 정보 */
export interface ProbeDiagnostics {
  /** window.SmartEditor 의 종류 (object, function, undefined …) */
  smartEditorType: string;
  /** SmartEditor 가 가진 칸 이름들 */
  smartEditorKeys: string[];
  /** 에디터 모음(_editors)의 종류 */
  editorsType: string;
  /** 에디터 모음에 든 개수 */
  editorCount: number;
  /** 에디터와 관련 있어 보이는 전역 이름들 */
  globalsLikeEditor: string[];
  /** 이 프레임 안의 프레임들 */
  iframes: string[];
}

export interface ProbeResult {
  /** 이 결과가 나온 프레임의 주소 */
  href: string;
  /** 맨 바깥 프레임인지 */
  isTop: boolean;
  /** 에디터를 찾았는지 */
  found: boolean;
  /** 찾지 못했거나 읽다 실패한 이유 */
  reason: string | null;
  /** 에디터 이름들 */
  editorKeys: string[];
  /** 에디터가 가진 기능 이름들 */
  methods: string[];
  /** 에디터 버전으로 보이는 값 (자원 주소에서 찾는다) */
  editorVersion: string | null;
  /** 문서 맨 위 칸 이름들 */
  docKeys: string[];
  /** 제목 */
  title: string;
  /** 부품 수 */
  componentCount: number;
  /** 부품 요약 (앞에서 80개까지) */
  components: ComponentSummary[];
  /** 화면에 그려진 부품 수 */
  renderedCount: number;
  /** "작성 중인 글이 있습니다" 팝업이 보이는지 */
  draftPrompt: boolean;
  /** 문서 전체 (견본으로 저장할 때만). JSON 문자열 */
  rawJson: string | null;
  /** 문서 전체가 너무 커서 싣지 않았는지 */
  rawTooLarge: boolean;
  /** 진단 정보 */
  diag: ProbeDiagnostics;
}
