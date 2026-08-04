/**
 * SEO 강의 기반 단계별 글쓰기 워크플로 (정적 시드).
 *
 * 사용자가 들은 강의의 8개 프롬프트를 순차적으로 실행하는 구조.
 * - 변수 치환: {{main_keyword}}, {{prev_output}}, {{selected_title}}
 * - 단계 내 멀티턴: hasUserTurn=true 인 단계는 LLM ↔ 사용자가 여러 턴 주고받음
 * - 플랫폼별 시퀀스: 네이버 블로그 vs 자체 도메인
 */

export type Platform = "naver_blog" | "custom_domain";
export type Mode = "api" | "copy";

export interface WorkflowStep {
  id: number; // 1-based
  title: string;
  short_label: string; // 사이드바용
  /** 프롬프트 본문 — {{var}} 치환 */
  prompt: string;
  /** 단계 내 사용자 응답이 필요한지 (LLM이 질문하고 답을 받는 흐름) */
  has_user_turn: boolean;
  /** 직전 단계 산출물을 prompt 앞에 prepend 할지 */
  needs_prev_output: boolean;
  /** step 7 처럼 사용자가 사전에 선택한 타이틀이 필요한지 */
  needs_selected_title: boolean;
  /** 어느 플랫폼에서 보일지 (모두면 양쪽 다) */
  platforms: Platform[];
  /** 옵션 단계 (시작 시 토글로 포함 여부 결정 가능) */
  optional: boolean;
}

const PROMPT_1 = `[프롬프트 1: 검색 의도, 개요]

당신은 15년 경력의 SEO 전략가이자 콘텐츠 기획 전문가입니다.
다음 메인 키워드에 대해 검색 의도를 분석하고,
그 의도에 최적화된 콘텐츠 개요를 작성해주세요.

메인 키워드: {{main_keyword}}

---

[STEP 1] 검색자의 상황과 심리 분석

이 키워드를 검색하는 사용자의

- 현재 상황
- 해결하고 싶은 문제
- 궁금한 핵심 질문

을 구체적으로 설명하세요.

---

[STEP 2] SEO 콘텐츠 개요 작성

H1 ~ H3 구조로 실제 블로그 개요를 작성하세요.
이 때 꼭 리서치를 해서 실제 정보를 기반으로 작성하고 레퍼런스를 알려주세요.

형식:

H1:
H2:
H3, H4는 꼭 필요한 경우에만 넣어주세요.

조건:
- 검색 의도를 가장 먼저 충족하는 구조로 작성
- AEO, GEO를 고려한 구조로 작성
- 불필요한 서론은 제외
- 실무자가 바로 글을 쓸 수 있도록 구체적으로 작성`;

const PROMPT_2 = `[프롬프트 2: H2, H3 정리]

위 콘텐츠 개요의 H2, H3 소제목을 검토하고,
GEO 기준으로 불필요한 섹션을 찾아주세요.

단, 소제목은 임의로 삭제하지 말고,
삭제 여부를 사용자에게 먼저 질문하세요.

[STEP 1] 소제목 진단

각 H2에 대해 아래 기준으로 평가하세요.

1. 검색자가 실제로 궁금해할 질문인가?
2. AI가 답변으로 사용할 수 있는 내용인가?
3. 문제 해결, 선택, 비교에 도움이 되는가?

→ 각 소제목을 다음 중 하나로 분류하세요.

- 유지
- 수정 권장
- 삭제 후보

이유는 한 줄로 간단히 설명하세요.

---

[STEP 2] 삭제 여부 질문

삭제 후보로 판단된 소제목에 대해
다음 형식으로 사용자에게 물어보세요.

예시:
다음 섹션은 GEO 관점에서 활용도가 낮을 수 있습니다.
삭제할까요?

- H2: ○○○
이유: AI가 답변으로 사용할 가능성이 낮음 / 서론 성격

→ 삭제 여부를 선택해주세요.
(삭제 / 유지)

---

(사용자 답변을 기다립니다)

---

[STEP 3] 최종 구조 재정리

사용자의 선택을 반영하여

- 삭제된 소제목 제거
- 수정 권장 소제목은 질문 형태로 개선(필요한 경우)
- H2는 가능하면 검색자 질문 형태로 작성(필요한 경우)

출력 형식

최종 구조
H1:
H2:
H3, H4는 꼭 필요한 경우에만 작성`;

const PROMPT_3 = `[프롬프트 3: 콘텐츠 작성]

위 개요를 기반으로
SEO + AEO/GEO를 고려한 블로그 초안을 작성해주세요.

---

[STEP 1] 콘텐츠 방향 확인

본문 작성 전에 사용자에게 다음을 질문하세요.

1. 이 글의 주요 목적은 무엇인가요?
- 브랜드 인지도
- 리드/문의 유도
- 제품/서비스 구매 또는 가입 유도
- 다른 콘텐츠로 이동 유도 (내부 링크)
- 기타 (직접 입력)

2. 원하는 톤앤매너는 무엇인가요?
예:
- 정보 중심 / 중립적
- 실무 경험 중심
- 친절한 설명형
- 개인 경험/후기 스타일
- 데이터 기반
- 기타 (직접 입력)

3. CTA에서 유도하고 싶은 행동은 무엇인가요?
예:
- 상담/문의
- 서비스 페이지 이동
- 다른 글 읽기
- 자료 다운로드
- 뉴스레터 구독
- 기타

→ 사용자 답변을 받은 후 STEP 2를 진행하세요.

---

[STEP 2] SEO + EEAT 본문 초안 작성

다음 기준에 따라 작성하세요.

1. AEO/GEO 구조
- 각 H2 아래에 핵심 내용이나 결론을 먼저 제시하세요.
- 명확하고 직접적인 문장으로 작성하세요.

2. EEAT 반영
단순 정보 정리가 아니라,
다음 요소 중 해당되는 내용을 포함하세요.

- 실제 경험 또는 사용 사례
- 관찰하거나 비교한 내용
- 상황별 설명
- 선택 또는 판단에 도움이 되는 정보
- 주의할 점 또는 한계

(반드시 전문가 관점일 필요는 없으며,
실제 경험, 사례, 관찰 기반 내용이면 충분합니다.)

3. 모바일 가독성
- 문장은 짧고 명확하게 작성하세요.
- 한 문단은 2~4줄 이내로 작성하세요.
- 대부분 줄글 형태로 작성하세요.
- 인용구나 콜아웃은 필요할 때만 제한적으로 사용하세요.
- 이모지는 사용하지 마세요.

4. CTA 구성
- STEP 1에서 설정한 목적에 맞게
  글 흐름 속에 자연스럽게 CTA를 2~3회 배치하세요.
- 광고처럼 보이지 않도록 정보 흐름 안에서 제안 형태로 작성하세요.

초안 작성할 때 반드시 웹검색을 해서 정확한 정보를 토대로 작성해주세요.
그리고 출처를 알려주세요.`;

const PROMPT_4 = `[프롬프트 4: 초안 다듬기]

블로그 초안을 읽고,
다음 5가지 기준으로 평가하고 개선점을 제안해주세요.

---
검수 기준

1. 자연스러운 표현
- 어색한 표현, 번역체, 기계적인 문장이 없는지 확인
- 자연스럽지 않은 부분이 있다면 수정 문장 제안

2. 메시지 전달력
- 작성자가 전달하려는 핵심 메시지나 관점이 명확한지 평가
- 부족한 내용이 있다면 보완 제안

3. 정보의 충분성 (검색 만족도)
- 독자가 이 글을 읽은 후,
  같은 검색어로 다른 글을 다시 찾을 필요가 없을 정도로 충분한지 평가
- 부족한 정보가 있다면 추가 제안

4. 독창성
- 단순 정보 정리에 그치지 않는지 확인
- 차별화를 위해 추가하면 좋은 관점, 설명, 사례 제안

---
추가 진단 — 경험 기반 콘텐츠 (E-E-A-T)

다음 요소가 포함되어 있는지 확인하세요.

실제 고객 질문 또는 고민
상담 / 세일즈 / 미팅 기반 사례
프로젝트 성과 데이터 (수치 변화, 기간 등)
의사결정 과정 또는 실패 경험
현장에서 반복적으로 발견한 인사이트

부족하다면 아래 형식으로 제안하세요.

[경험 요소 보강]
추가하면 좋은 경험 자료:
예시로 넣을 수 있는 상황:

---
출력 형식

[총평]
전반적인 완성도 (상 / 중 / 하)와 이유

[항목별 피드백]

1. 자연스러운 표현
- 문제 문장:
- 수정 제안:

2. 메시지 전달력
- 보완 필요 내용:

3. 정보의 충분성
- 추가하면 좋은 내용:

4. 독창성
- 개선 제안:

---

[경험 요소 보강]

추가하면 좋은 경험 자료:

예시 상황:

---
피드백을 반영하여 초안을 수정할까요?
원하시면 "수정해줘"라고 답해주세요.

---
(사용자가 "수정해줘"라고 답하면 다음 작업 수행)

[STEP 2] 수정본 작성

- 위에서 제안한 개선사항을 반영하여 전체 글을 다시 작성하세요.
- 원래 구조(H1~H3)는 유지하세요.
- 문장은 더 자연스럽고 읽기 쉽게 수정하세요.
- 추가 정보는 흐름에 맞게 자연스럽게 포함하세요.
- 중복되거나 불필요한 내용은 정리하세요.
- 모바일 가독성을 고려하여 문단은 2~4줄 이내로 유지하세요.
- CTA 등은 수정하지마세요.

출력 형식
[수정된 최종 초안]`;

const PROMPT_5 = `[프롬프트 5: AEO 구조]
글의 내용은 수정하지말고 구조만 업그레이드시켜주세요.

조건: AEO 구조 적용

AI가 답변으로 활용하기 쉽도록,
내용 흐름을 해치지 않는 범위에서 다음 구조를 적용하세요.

중요한 내용은 결론 먼저 제시(결론:이라고 표기하지 않기)
핵심 내용은 정리된 문장으로 혹은 불릿 리스트로 정리
비교 또는 정리가 필요한 경우 표 사용
방법이나 절차는 단계형(번호 리스트)으로 구성
필요한 경우 요약 또는 핵심 정리 블록 추가
※ 구조는 과도하게 추가하지 말고 자연스럽게 적용하세요.

그리고, 이미지 가이드 포함해주세요
각 주요 섹션마다 아래 형식으로 제안하세요.

[이미지 제안]
- 위치: (예: H2 아래)
- 유형: (예: 비교표 / 실제 화면 / 과정 다이어그램 / 체크리스트 등)
- 목적: 독자가 어떤 내용을 더 쉽게 이해하기 위한 이미지인지 설명
- SEO를 고려한 alt text

----
출력 형식

[수정된 최종 초안 - 앞서 작성한 초안을 여기에 삽입]`;

const PROMPT_6 = `[프롬프트 6: 타이틀, 디스크립션]

당신은 SEO 전문가이자 CTR(클릭률) 최적화 카피라이터입니다.

위 블로그 초안 내용을 참고하여,
검색 의도에 맞으면서도 클릭을 유도할 수 있는
SEO 제목과 메타 디스크립션을 작성해주세요.

메인 키워드: {{main_keyword}}

---
목표

SEO 노출과 함께 클릭률(CTR)을 높이는 것이 가장 중요합니다.

글자 수는 너무 길지만 않으면 되며,
자연스럽고 읽기 쉬운 것이 더 중요합니다.

단, 메인 키워드는 제목의 앞부분에 배치하세요.

---
Title 작성 기준

각 제목에는 아래 요소 중 최소 2가지 이상을 포함하세요.

1. 검색 의도 반영
   (정보 / 추천 / 비교 / 방법 등)

2. 구체성
   (숫자, 대상, 상황, 기준 등)

3. 차별 포인트
   (실무 기준, 실제 사용, 정리, 핵심, 최신 등)

4. 호기심 또는 문제 해결 요소
   (선택 기준, 실패 방지, 중요한 포인트 등)

조건
- 메인 키워드는 제목 앞부분에 배치하세요.
- 보조 키워드는 자연스럽게 활용하세요.
- 과장되거나 낚시성 표현은 사용하지 마세요.
- 초안 내용과 일치해야 합니다.
- 서로 다른 스타일로 5개 작성하세요.

---
Meta Description 작성 기준

- 메인 키워드를 자연스럽게 포함하세요.
- 다음 흐름으로 작성하세요.

검색자의 상황 또는 문제
→ 이 글에서 제공하는 핵심 내용
→ 얻을 수 있는 도움 또는 결과

- 너무 길지 않게, 검색 결과에서 잘릴 수 있음을 고려해 간결하게 작성하세요.
- 과장된 광고 문구는 사용하지 마세요.

---

출력 형식

1.
Title:
(포함 요소: 검색의도 / 구체성 / 차별 / 호기심)

Description:

2.
Title:
(포함 요소 표시)

Description:`;

const PROMPT_7 = `[프롬프트 7: URL]

다음 정보를 기반으로
검색엔진에 최적화된 URL 슬러그를 만들어주세요.

메인 키워드: {{main_keyword}}
타이틀: {{selected_title}}

작성 기준

- 영어로 작성하세요.
- 단어 사이에는 하이픈(-)을 사용하세요.
- 짧고 간결하게 작성하세요.
- 불필요한 단어는 제외하세요.
- 메인 키워드의 의미가 잘 드러나도록 작성하세요.

총 3개 제안해주세요.

출력 형식

1. /example-url
2. /example-url
3. /example-url`;

const PROMPT_8 = `[프롬프트 8: 롱테일 키워드]

당신은 키워드 리서치 전문가이며, 다음 기본 키워드를 기반으로 실제 검색량이 있을 법한 한국어 롱테일 키워드 50개를 생성하세요.
다음 기본 키워드를 기반으로 롱테일 키워드 50개를 생성해주세요.

기본 키워드: {{main_keyword}}

요구사항

1. 실제 검색 환경 기준
- 네이버/구글 자동완성에 나타날 법한 표현 사용
- 대중적으로 많이 검색되는 형태로 작성

2. 길이 제한
- 키워드는 15~25자 이내
- 2~5단어 수준의 짧은 검색 형태

---

출력 형식

마크다운 표로 작성하세요.

| Keyword |

표 아래에는 다음 문장을 출력하세요.

그리고 다음 줄에 위에서 생성한 키워드 50개를 쉼표로 구분하여 한 줄로 작성하세요.

---
주의사항

- 키워드를 중복하지 마세요.
- 불필요한 설명은 작성하지 마세요.
- 작업 과정이나 자기 언급을 하지 마세요.
- 결과만 출력하세요.`;

export const SEO_WORKFLOW: WorkflowStep[] = [
  {
    id: 1,
    title: "검색 의도 + 콘텐츠 개요",
    short_label: "검색 의도·개요",
    prompt: PROMPT_1,
    has_user_turn: false,
    needs_prev_output: false,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 2,
    title: "H2/H3 정리",
    short_label: "구조 정리",
    prompt: PROMPT_2,
    has_user_turn: true,
    needs_prev_output: true,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 3,
    title: "본문 초안 작성",
    short_label: "초안",
    prompt: PROMPT_3,
    has_user_turn: true,
    needs_prev_output: true,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 4,
    title: "초안 다듬기",
    short_label: "다듬기",
    prompt: PROMPT_4,
    has_user_turn: true,
    needs_prev_output: true,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 5,
    title: "AEO 구조 + 이미지 가이드",
    short_label: "AEO 구조",
    prompt: PROMPT_5,
    has_user_turn: false,
    needs_prev_output: true,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 6,
    title: "타이틀 · 메타 디스크립션",
    short_label: "Title/Desc",
    prompt: PROMPT_6,
    has_user_turn: false,
    needs_prev_output: true,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: false,
  },
  {
    id: 7,
    title: "URL 슬러그 (자체 도메인용)",
    short_label: "URL 슬러그",
    prompt: PROMPT_7,
    has_user_turn: false,
    needs_prev_output: false,
    needs_selected_title: true,
    platforms: ["custom_domain"],
    optional: false,
  },
  {
    id: 8,
    title: "롱테일 키워드 50개 (보너스)",
    short_label: "롱테일 키워드",
    prompt: PROMPT_8,
    has_user_turn: false,
    needs_prev_output: false,
    needs_selected_title: false,
    platforms: ["naver_blog", "custom_domain"],
    optional: true,
  },
];

/** 플랫폼별 사용할 단계 시퀀스 (선택 옵션 단계 포함 여부 결정 가능) */
export function getStepsForPlatform(platform: Platform, includeOptional: boolean): WorkflowStep[] {
  return SEO_WORKFLOW.filter(
    (s) => s.platforms.includes(platform) && (includeOptional || !s.optional),
  );
}

export function findStep(stepId: number): WorkflowStep | undefined {
  return SEO_WORKFLOW.find((s) => s.id === stepId);
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  naver_blog: "네이버 블로그",
  custom_domain: "자체 도메인 / 워드프레스 / 티스토리",
};

export const MODE_LABELS: Record<Mode, string> = {
  api: "API 자동 진행 (LLM과 대화하며 생성)",
  copy: "프롬프트 복사 수동 진행 (직접 ChatGPT/Claude 사용)",
};
