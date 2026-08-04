/**
 * 콘텐츠 서비스 REST 클라이언트 (브라우저 + 서버 양쪽).
 *
 * 라우팅 전략:
 *  - keywords / images / cards : 같은 Next.js 서버의 /api/* 사용 (LOCAL_BASE = "")
 *  - generate / health         : 외부 FastAPI content_service (EXTERNAL_BASE = NEXT_PUBLIC_CONTENT_SERVICE_URL)
 *
 * NEXT_PUBLIC_CONTENT_SERVICE_URL이 비어있으면 generate/health 호출 시 에러 발생.
 */
const LOCAL_BASE = "";
const EXTERNAL_BASE =
  process.env.NEXT_PUBLIC_CONTENT_SERVICE_URL?.replace(/\/$/, "") || "";

export interface ResearchContextItem {
  title: string;
  description?: string;
  body?: string | null;
  link?: string;
  bloggername?: string;
}

export type SearchIntent = "정보탐색" | "자격진단" | "절차해결" | "문제해결" | "비교선택";
export type JtbdType = "시간절약" | "리스크회피" | "의사결정지원" | "자기효능감" | "위임판단";

export interface BlogGenerationInput {
  method_id: number;
  topic: string;
  main_keyword: string;
  sub_keywords: string[];
  target_awareness_level?: "L1" | "L2" | "L3" | "L4";
  /** Ontology B v2 — 검색의도 (3축 중 2번째) */
  search_intent?: SearchIntent;
  /** Ontology B v2 — JTBD (3축 중 3번째) */
  jtbd_type?: JtbdType;
  domain_info?: Record<string, unknown>;
  /** 독자 페르소나 — 글을 *읽는* 사람의 직업/페인포인트/욕망 */
  persona?: string;
  /** 작성자 페르소나 — 글을 *쓰는* 사람의 경력/톤/말투/전문성 */
  author_persona?: string;
  brand_voice?: {
    author_identity?: string;
    consultancy_name?: string;
  };
  generation_options?: {
    max_retries?: number;
    axiom_pass_threshold?: number;
    min_body_char_count?: number;
  };
  /** 같은 키워드의 상위 노출 블로그 N개 — LLM 차별화 참고용 */
  research_context?: ResearchContextItem[];
}

export interface GenerateRequest {
  input: BlogGenerationInput;
  provider?: "gemini" | "openai" | "anthropic";
  model?: string;
  /** Ontology v2 — 도메인 코드 (선택) */
  domain_code?: string | null;
}

export interface AttemptSummary {
  attempt: number;
  parse_ok: boolean;
  axiom_total: number;
  axiom_passed: number;
  axiom_failed: number;
  duration_ms: number;
}

export interface UsageCost {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_krw: number | null;
  pricing_known: boolean;
}

export interface GenerateResponse {
  provider: string;
  model: string;
  duration_ms: number;
  final_attempt: number;
  needs_human_review: boolean;
  cost?: UsageCost;
  parse_ok: boolean;
  parse_errors: string[];
  mapping: Record<string, unknown>;
  titles: Array<{
    rank: number;
    title: string;
    main_keyword_position: string;
    click_driver: string;
    ctr_stars: number;
  }>;
  body: string;
  axiom_check: {
    total?: number;
    passed?: number;
    failed?: number;
    pass_rate?: string;
    items?: Array<{
      number: number;
      rule: string;
      passed: boolean;
      evidence: string;
    }>;
    failed_rules?: number[];
  };
  suggestions: Record<string, unknown>;
  meta: Record<string, unknown>;
  attempts: AttemptSummary[];
  post_id: string | null;
}

export type KeywordIntent = "question" | "comparison" | "transactional" | "informational";

export interface KeywordMetric {
  keyword: string;
  monthly_pc_qc: number;
  monthly_mobile_qc: number;
  total_qc: number;
  blog_monthly_count: number | null;
  blog_saturation: number | null;
  shopping_category: string | null;
  monthly_ave_pc_clk: number | null;
  monthly_ave_mobile_clk: number | null;
  monthly_ave_pc_ctr: number | null;
  monthly_ave_mobile_ctr: number | null;
  comp_idx: string | null;
  pl_avg_depth: number | null;
  intent: KeywordIntent;
  from_autocomplete: boolean;
}

export interface KeywordLookupResponse {
  query: string;
  /** 입력에서 파싱된 키워드들 (콤마 구분) */
  queried_keywords: string[];
  results: KeywordMetric[];
  source: "live" | "cache";
  autocomplete_added: number;
}

export interface TrendPoint {
  period: string;
  ratio: number;
}

export interface TrendResponse {
  keyword: string;
  start_date: string;
  end_date: string;
  time_unit: "date" | "week" | "month";
  data: TrendPoint[];
}

export interface RankResult {
  keyword: string;
  search_type: "blog" | "web";
  rank: number | null;
  matched_url: string | null;
  matched_title: string | null;
  total_results: number;
  error?: string;
}

export interface RankCheckRequest {
  domain: string;
  keywords: string[];
  types?: ("blog" | "web")[];
  top_n?: number;
}

export interface RankCheckResponse {
  domain: string;
  top_n: number;
  results: RankResult[];
  saved_count: number;
}

async function doFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} 실패 (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

function localRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return doFetch<T>(LOCAL_BASE, path, init);
}

function externalRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!EXTERNAL_BASE) {
    throw new Error(
      `${path} 호출에는 외부 content_service가 필요합니다. NEXT_PUBLIC_CONTENT_SERVICE_URL을 설정하세요.`,
    );
  }
  return doFetch<T>(EXTERNAL_BASE, path, init);
}

export interface CardBuildRequest {
  title: string;
  body: string;
  keywords?: string[];
  card_count?: number | "auto";
  use_ai?: boolean;
  provider?: "gemini" | "openai" | "anthropic";
  model?: string;
}

export interface CardBuildResponse {
  cards: Array<Record<string, unknown>>;
  used_ai: boolean;
}

export interface ResearchResponse {
  query: string;
  items: Array<{
    title: string;
    description: string;
    link: string;
    bloggername: string;
    postdate: string;
    body: string | null;
  }>;
}

export const contentService = {
  // 외부 FastAPI (헬스체크 등 — 현재는 안 씀)
  health: () => externalRequest<{ status: string }>("/health"),

  // 같은 Next.js 서버의 /api/* (모든 라우트가 여기로 통합됨)
  research: (q: string, n = 10, withBody = true) =>
    localRequest<ResearchResponse>(
      `/api/research?q=${encodeURIComponent(q)}&n=${n}&with_body=${withBody}`,
    ),
  generate: (body: GenerateRequest) =>
    localRequest<GenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  keywords: (q: string) =>
    localRequest<KeywordLookupResponse>(`/api/keywords?q=${encodeURIComponent(q)}`),
  keywordTrend: (q: string, months = 12) =>
    localRequest<TrendResponse>(
      `/api/keywords/trend?q=${encodeURIComponent(q)}&months=${months}`,
    ),
  rankCheck: (body: RankCheckRequest) =>
    localRequest<RankCheckResponse>("/api/rank-check", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cardsBuild: (body: CardBuildRequest) =>
    localRequest<CardBuildResponse>("/api/cards/build", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  imageSearch: (keyword: string, count = 3) =>
    localRequest<{ images: Array<Record<string, unknown>> }>(
      "/api/images/search",
      {
        method: "POST",
        body: JSON.stringify({ keyword, count }),
      },
    ),
  imageGenerate: (
    prompt: string,
    provider: "pollinations" | "dalle" | "gemini" = "pollinations",
  ) =>
    localRequest<{ path: string | null; url: string | null; provider: string }>(
      "/api/images/generate",
      {
        method: "POST",
        body: JSON.stringify({ prompt, provider }),
      },
    ),
};
