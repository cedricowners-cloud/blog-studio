// 글쓰기 방식 6개에 쓰는 값의 모양. 웹의 web/lib/ontology/prompt-builder.ts 와 같다.
// 업종 설정(domain_pack)은 로그인을 붙인 뒤에 넣는다. 지금은 없다.

export interface BrandVoice {
  author_identity?: string | null;
  consultancy_name?: string | null;
}

export interface GenerationOptions {
  max_retries?: number;
  axiom_pass_threshold?: number;
  min_body_char_count?: number;
}

export interface ResearchContextItem {
  title: string;
  description?: string;
  body?: string | null;
  link?: string;
  bloggername?: string;
}

/** 참고 뉴스 한 건. 확장의 자료 찾기에서 고른 것이다 (웹에는 없다) */
export interface NewsContextItem {
  title: string;
  description?: string;
  link?: string;
  /** 언론사 사이트 이름 */
  source?: string;
  /** 2026-11-18 모양 */
  date?: string;
}

export const AWARENESS_LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

export const SEARCH_INTENTS = ['정보탐색', '자격진단', '절차해결', '문제해결', '비교선택'] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export const JTBD_TYPES = ['시간절약', '리스크회피', '의사결정지원', '자기효능감', '위임판단'] as const;
export type JtbdType = (typeof JTBD_TYPES)[number];

export interface BlogGenerationInput {
  method_id: number;
  topic: string;
  main_keyword: string;
  sub_keywords: string[];
  target_awareness_level?: AwarenessLevel;
  search_intent?: SearchIntent;
  jtbd_type?: JtbdType;
  /** 글에 넣을 사실 자료 */
  domain_info?: Record<string, unknown> | null;
  /** 글을 읽는 사람 */
  persona?: string;
  /** 글을 쓰는 사람의 말투 */
  author_persona?: string;
  brand_voice?: BrandVoice | null;
  generation_options?: GenerationOptions;
  research_context?: ResearchContextItem[];
  /** 참고 뉴스. 확장에만 있다. 묶음에 글 조각(research.news_*)이 없으면 보내지 않는다 */
  news_context?: NewsContextItem[];
}

export const DEFAULT_OPTIONS: Required<GenerationOptions> = {
  max_retries: 2,
  axiom_pass_threshold: 1.0,
  min_body_char_count: 1500,
};
