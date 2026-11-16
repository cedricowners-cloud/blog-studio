// 웹 코드에 글자로 박혀 있는 프롬프트 조각을 옮겨 적은 것.
//   - web/lib/ontology/prompt-builder.ts  (입력 정보, 참고 자료, 기본값)
//   - web/lib/ontology/retry-loop.ts      (재작성 요청)
//   - web/lib/seo-workflow-engine.ts      (직전 단계 산출물)
// {{이름}} 자리는 확장이 값으로 채운다.
//
// 이 파일은 확장 패키지(dist)에 들어가지 않는다. 프롬프트 묶음 파일을 만들 때만 쓴다.
// 웹 코드의 글자가 바뀌면 tests/parity.test.ts 가 실패한다. 그때 여기를 맞춰 고친다.

const BAR = '═══════════════════════════════════════════════';

const lines = (...items: string[]) => items.join('\n');

export const GLUE: Record<string, string> = {
  // 값이 비었을 때 넣는 글자
  'default.unspecified': '(미지정)',
  'default.none': '(없음)',
  'default.persona': '30대 경영자/대표',
  'default.author_persona': '(미지정 — 친근하면서도 전문적인 일반 컨설턴트 톤으로)',

  // [입력 정보]
  'input.head': lines(
    BAR,
    '[입력 정보] — 이 정보를 기반으로 글을 작성하세요',
    BAR,
    '',
    '- **글 주제(topic)**: {{topic}}',
    '- **메인 키워드(main_keyword)**: {{main_keyword}}',
    '- **서브 키워드(sub_keywords)**: {{sub_keywords}}',
    '- **타겟 인지단계(target_awareness_level)**: {{awareness}}',
    '- **독자 페르소나(persona, 글을 *읽는* 사람)**: {{persona}}',
    '- **작성자 페르소나(author_persona, 글을 *쓰는* 사람의 톤·말투·전문성)**: {{author_persona}}',
    '- **방식(method_id)**: {{method_id}} — {{method_label}}',
  ),
  'input.brand_header': '- **브랜드 보이스**:',
  'input.brand_identity': '    - 작성자 정체성: {{v}}',
  'input.brand_org': '    - 소속: {{v}}',
  'input.domain_info': lines(
    '',
    '**도메인 정보(domain_info)** — 글에 반영할 사실 데이터:',
    '```json',
    '{{json}}',
    '```',
  ),
  'input.constraints': lines(
    '',
    '**생성 제약**:',
    '- 본문 최소 글자수: {{min_chars}}자',
    '- 공리 통과율 임계값: {{pass_pct}}%',
  ),

  // [참고 자료]
  'research.head': lines(
    '',
    BAR,
    '[참고 자료] — 같은 키워드 상위 노출 블로그 {{count}}개',
    BAR,
    '',
    '⚠️ 아래는 같은 메인 키워드로 검색했을 때 네이버 상위에 노출된 블로그입니다.',
    '다음 지침을 반드시 따르세요:',
    '1. 이들과 **차별화된 각도**로 작성 (같은 정보의 단순 재배열 금지)',
    '2. 이들이 다루지 않은 **추가 키워드·사실·관점**을 발굴해 본문에 반영',
    '3. 표현·문장 **표절 절대 금지**. 표현이 비슷하면 자체 검열로 다시 작성',
    '4. 단, 사실 데이터(법령·금액·일정 등)는 정확성 우선 — 동일해도 무방',
    '',
  ),
  'research.item_title': '### 참고 {{n}}. {{title}}',
  'research.no_title': '(제목 없음)',
  'research.item_blogger': '- 블로거: {{v}}',
  'research.item_link': '- 링크: {{v}}',
  'research.item_desc': '- 요약: {{v}}',
  'research.item_body': '- 본문 발췌:\n```\n{{v}}\n```',

  // [재작성 요청]
  'feedback.head': lines('', BAR, '[재작성 요청] — 직전 응답에 다음 문제가 있습니다', BAR, ''),
  'feedback.too_short': lines(
    '❗ 본문 글자수 부족: 현재 {{current}}자, 최소 {{min}}자 이상 필요.',
    '  - 섹션을 더 추가하거나 각 섹션에 사례·근거·맥락을 보강해서 길이를 늘리세요.',
    '  - 단, 키워드 무리한 반복으로 채우지 말 것. 의미 있는 정보를 추가.',
    '',
  ),
  'feedback.failed_head': lines(
    '❗ 다음 공리를 충족하지 못했습니다. 각각에 대해 본문을 **해당 부분만 최소한으로 보강**:',
    '',
  ),
  'feedback.failed_item': '- 공리 {{number}}: {{rule}}',
  'feedback.failed_evidence': '  (이전 근거: {{evidence}})',
  'feedback.tail': lines(
    '직전 본문:',
    '```',
    '{{body}}',
    '```',
    '',
    '요구사항:',
    '- 위 문제를 모두 해결한 전체 JSON 응답을 다시 출력 (줄임표·잘림 금지)',
    '- axiom_check.items 전체를 다시 작성 (누락 없이)',
    '- JSON 스키마 그대로 유지',
  ),

  // SEO 8단계: 직전 단계의 결과를 앞에 붙일 때
  'seo.prev_wrapper': '[직전 단계 산출물]\n{{prev}}\n\n---\n\n{{prompt}}',
};

/** 방식 번호 → 파일 이름과 이름표. 웹의 METHOD_FILENAMES, METHOD_LABELS 와 같다. */
export const METHODS: { id: number; file: string; label: string }[] = [
  { id: 1, file: '01_crank_diaplus_v2.md', label: 'C랭크 다이아플러스' },
  { id: 2, file: '02_alcon_v2.md', label: '알콘' },
  { id: 3, file: '03_aeo_v2.md', label: 'AEO' },
  { id: 4, file: '04_homefeed_v2.md', label: '홈피드' },
  { id: 5, file: '05_insight_edge_v2.md', label: '인사이트 엣지' },
  { id: 6, file: '06_info_govt_v2.md', label: 'C랭크 정보성 (정부지원)' },
];

export const COMMON_FILE = '00_common_ontology.md';
