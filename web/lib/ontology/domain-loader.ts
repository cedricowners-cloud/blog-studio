/**
 * Domain Pack Loader (DB version, Ontology v2)
 *
 * 도메인 패키지 데이터를 Supabase `domains` 테이블에서 로드.
 * (이전: 마크다운 파일에서 로드 → 현재: DB JSONB 컬럼)
 *
 * 사용처:
 *  - /api/generate route — 글 생성 시 도메인 데이터 주입
 *  - /domains/[code] page — 편집 UI에서 read/write
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DifferentiatingBenefit = "안전" | "신속" | "심층" | "동반" | "독창";

const BRAND_VOICE_AXIOM_MAP: Record<DifferentiatingBenefit, string[]> = {
  안전: [
    "BV1: 리스크·실패사례 최소 1건 명시",
    "BV2: 제외요건·예외조항 명시",
    "BV3: 단정적 표현 자제, 조건부 표현 우선",
  ],
  신속: [
    "BV1: 핵심 답이 글 첫 화면(상단 박스) 안에 위치",
    "BV2: 글 길이 1,500~2,000자 상한",
    "BV3: 모든 섹션에 3초 요약 박스 포함",
  ],
  심층: [
    "BV1: 일반론 반박 구조 강제",
    "BV2: 데이터·사례 인용 최소 3건",
    "BV3: 차별화 포인트를 글 도입부에 명시",
  ],
  동반: [
    "BV1: 1인칭(저희가/함께) 최소 3회",
    "BV2: 공감 표현 최소 1회",
    "BV3: 마무리에 지속 관계 신호",
  ],
  독창: [
    "BV1: 글 도입부에 기존 통념 명시",
    "BV2: 반박·재정의 구조 강제",
    "BV3: 새로운 프레임 제시 + 실천 방법 연결",
  ],
};

export class DomainNotFoundError extends Error {
  constructor(domainCode: string) {
    super(`도메인을 찾을 수 없습니다: ${domainCode}`);
    this.name = "DomainNotFoundError";
  }
}

// ============================================================
// 데이터 타입 — DB JSONB 구조와 매핑
// ============================================================

export interface PositioningData {
  target_audience: string;
  competitive_reference: string;
  differentiating_benefit: DifferentiatingBenefit;
  category: string;
  reason_to_believe: string[];
  value_proposition_pattern: string; // 공리 #11 슬롯
  core_answer_type: string; // 공리 #12 슬롯
}

export interface AwarenessLevelData {
  pains: string[];
  triggers: string[];
}

export interface ReaderData {
  L1: AwarenessLevelData;
  L2: AwarenessLevelData;
  L3: AwarenessLevelData;
  L4: AwarenessLevelData;
  intent_patterns: Record<string, string[]>; // {정보탐색: [...], ...}
  jtbd_value_map: Record<string, string>; // {시간절약: "...", ...}
}

export interface LexiconData {
  terms: Array<{ term: string; definition: string; plain: string }>;
  confusables: Array<{ a: string; b: string; distinction: string }>;
  forbidden: Array<{ expression: string; reason: string }>;
  recommended: Array<{ situation: string; expression: string }>;
}

export type CardMood = "professional" | "friendly" | "bold" | "soft";

export interface CardColors {
  /** Cover 카드 그라데이션 시작색 + Content 헤딩·섹션 라벨 색 */
  primary: string;
  /** Cover 카드 그라데이션 끝색 */
  primary_gradient_to: string;
  /** Closing 카드 배경 (보통 어두운 톤) */
  secondary: string;
  /** List 카드 번호 원형 마커 색 */
  accent: string;
  /** Content 카드 배경 */
  background: string;
  /** List 카드 배경 */
  list_background: string;
  /** Closing 카드 그라데이션 시작 */
  closing_gradient_from: string;
  /** Closing 카드 그라데이션 끝 */
  closing_gradient_to: string;
  /** 본문 헤딩 색 */
  text_dark: string;
  /** 본문 보조 텍스트 색 */
  text_muted: string;
  /** 페이지 번호 (NN/NN) 색 */
  page_badge: string;
}

export interface CardDesign {
  brand_name: string;
  colors: CardColors;
  mood: CardMood;
  font_family: string;
}

export const EMPTY_CARD_DESIGN: CardDesign = {
  brand_name: "",
  colors: {
    primary: "#1E3A8A",
    primary_gradient_to: "#1E40AF",
    secondary: "#0F172A",
    accent: "#1E3A8A",
    background: "#FFFFFF",
    list_background: "#F8FAFC",
    closing_gradient_from: "#0F172A",
    closing_gradient_to: "#1E293B",
    text_dark: "#0F172A",
    text_muted: "#475569",
    page_badge: "#94A3B8",
  },
  mood: "professional",
  font_family: "Pretendard",
};

export interface DomainRow {
  id: string;
  domain_code: string;
  domain_name: string;
  positioning_benefit: string; // 호환용 — 실제로는 positioning_data 안에 있음
  package_path: string;
  is_active: boolean;
  positioning_data: PositioningData | null;
  reader_data: ReaderData | null;
  lexicon_data: LexiconData | null;
  class_markdown: string | null;
  card_design: CardDesign | null;
  created_at: string;
  updated_at: string;
}

export interface DomainPack {
  domainCode: string;
  domainName: string;
  positioning: PositioningData;
  reader: ReaderData;
  lexicon: LexiconData;
  classMarkdown: string;
  cardDesign: CardDesign;
  /** Brand Voice 공리 자동 매핑 결과 (positioning.differentiating_benefit 기반) */
  activeBrandVoiceAxioms: string[];
}

// ============================================================
// 빈 기본값 (검증·신규 도메인 생성용)
// ============================================================

export const EMPTY_POSITIONING: PositioningData = {
  target_audience: "",
  competitive_reference: "",
  differentiating_benefit: "안전",
  category: "",
  reason_to_believe: [],
  value_proposition_pattern: "",
  core_answer_type: "",
};

export const EMPTY_READER: ReaderData = {
  L1: { pains: [], triggers: [] },
  L2: { pains: [], triggers: [] },
  L3: { pains: [], triggers: [] },
  L4: { pains: [], triggers: [] },
  intent_patterns: {
    정보탐색: [],
    자격진단: [],
    절차해결: [],
    문제해결: [],
    비교선택: [],
  },
  jtbd_value_map: {
    시간절약: "",
    리스크회피: "",
    의사결정지원: "",
    자기효능감: "",
    위임판단: "",
  },
};

export const EMPTY_LEXICON: LexiconData = {
  terms: [],
  confusables: [],
  forbidden: [],
  recommended: [],
};

// ============================================================
// 로더 — Supabase에서 도메인 행 조회 + DomainPack 변환
// ============================================================

/**
 * 도메인 코드로 도메인 패키지 로드.
 * 호출자가 SupabaseClient를 넘김 (서버: getServerSupabase / 브라우저: getBrowserSupabase).
 */
export async function loadDomainPack(
  client: SupabaseClient,
  domainCode: string,
): Promise<DomainPack> {
  const { data, error } = await client
    .from("domains")
    .select("*")
    .eq("domain_code", domainCode)
    .eq("is_active", true)
    .single();

  if (error || !data) throw new DomainNotFoundError(domainCode);

  const row = data as DomainRow;
  const positioning = row.positioning_data ?? EMPTY_POSITIONING;
  const reader = row.reader_data ?? EMPTY_READER;
  const lexicon = row.lexicon_data ?? EMPTY_LEXICON;
  const classMarkdown = row.class_markdown ?? "";
  const cardDesign = row.card_design ?? EMPTY_CARD_DESIGN;

  return {
    domainCode: row.domain_code,
    domainName: row.domain_name,
    positioning,
    reader,
    lexicon,
    classMarkdown,
    cardDesign,
    activeBrandVoiceAxioms: BRAND_VOICE_AXIOM_MAP[positioning.differentiating_benefit] ?? [],
  };
}

/**
 * 모든 활성 도메인 목록 (UI에서 셀렉트 옵션용).
 */
export async function listDomains(client: SupabaseClient): Promise<DomainRow[]> {
  const { data, error } = await client
    .from("domains")
    .select("*")
    .eq("is_active", true)
    .order("domain_code");
  if (error) throw new Error(`도메인 목록 조회 실패: ${error.message}`);
  return (data as DomainRow[]) ?? [];
}

/**
 * 도메인 데이터 부분 업데이트 (UI 폼 저장용).
 */
export async function updateDomainData(
  client: SupabaseClient,
  domainCode: string,
  patch: Partial<Pick<DomainRow, "domain_name" | "positioning_data" | "reader_data" | "lexicon_data" | "class_markdown" | "card_design" | "is_active">>,
): Promise<void> {
  const { error } = await client.from("domains").update(patch).eq("domain_code", domainCode);
  if (error) throw new Error(`도메인 업데이트 실패: ${error.message}`);
}

/**
 * 새 도메인 생성 (빈 기본값으로).
 */
export async function createDomain(
  client: SupabaseClient,
  args: { domain_code: string; domain_name: string },
): Promise<void> {
  const { error } = await client.from("domains").insert({
    domain_code: args.domain_code,
    domain_name: args.domain_name,
    positioning_benefit: "안전", // 호환 컬럼
    package_path: `web/domain_packs/${args.domain_code}`,
    is_active: true,
    positioning_data: EMPTY_POSITIONING,
    reader_data: EMPTY_READER,
    lexicon_data: EMPTY_LEXICON,
    class_markdown: "",
    card_design: EMPTY_CARD_DESIGN,
  });
  if (error) throw new Error(`도메인 생성 실패: ${error.message}`);
}

/**
 * 도메인 비활성화 (soft delete).
 */
export async function deactivateDomain(client: SupabaseClient, domainCode: string): Promise<void> {
  const { error } = await client
    .from("domains")
    .update({ is_active: false })
    .eq("domain_code", domainCode);
  if (error) throw new Error(`도메인 비활성화 실패: ${error.message}`);
}

/**
 * 도메인 영구 삭제 (hard delete, blog_posts.domain_id는 ON DELETE SET NULL로 처리됨).
 */
export async function deleteDomain(client: SupabaseClient, domainCode: string): Promise<void> {
  const { error } = await client.from("domains").delete().eq("domain_code", domainCode);
  if (error) throw new Error(`도메인 삭제 실패: ${error.message}`);
}

/**
 * Brand Voice 공리 매핑을 외부에서도 참조 가능하도록 export.
 */
export { BRAND_VOICE_AXIOM_MAP };
