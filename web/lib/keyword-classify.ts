/**
 * 한국어 키워드 의도 분류기 — 패턴 매칭 (LLM·외부 호출 없음).
 *
 * 우버서제스트의 "Questions / Comparisons / Prepositions" 와 비슷한 분류 +
 * 한국 검색 패턴에 맞춘 카테고리:
 *   question     — 질문형 ("방법", "어떻게", "이란", "뜻" 등)
 *   comparison   — 비교형 ("vs", "차이", "비교", "어떤게")
 *   transactional— 거래형 ("추천", "후기", "리뷰", "최저가", "할인")
 *   informational— 정보형 (그 외 일반 정보 탐색)
 */

export type KeywordIntent = "question" | "comparison" | "transactional" | "informational";

const QUESTION_PATTERNS = [
  /방법/, /어떻게/, /왜/, /언제/, /어디/, /얼마/, /이란/, /란무엇/, /뜻/, /의미/,
  /\?$/, /정의/, /원리/, /이유/, /필요한가/, /해야하나/, /가능한가/,
];

const COMPARISON_PATTERNS = [
  /\bvs\b/i, /비교/, /차이/, /어떤게/, /어떤것/, /vs\./i, /대\s*비/, /대비\s/,
];

const TRANSACTIONAL_PATTERNS = [
  /추천/, /후기/, /리뷰/, /최저가/, /할인/, /쿠폰/, /이벤트/, /구매/, /가격/,
  /신청/, /접수/, /지원/, /무료/, /다운로드/, /설치/,
];

export function classifyKeyword(keyword: string): KeywordIntent {
  const k = keyword.trim();
  if (!k) return "informational";
  if (COMPARISON_PATTERNS.some((p) => p.test(k))) return "comparison";
  if (QUESTION_PATTERNS.some((p) => p.test(k))) return "question";
  if (TRANSACTIONAL_PATTERNS.some((p) => p.test(k))) return "transactional";
  return "informational";
}

export const INTENT_LABELS: Record<KeywordIntent, string> = {
  question: "질문형",
  comparison: "비교형",
  transactional: "거래형",
  informational: "정보형",
};

export const INTENT_COLORS: Record<KeywordIntent, string> = {
  question: "bg-blue-50 text-blue-700 border-blue-200",
  comparison: "bg-purple-50 text-purple-700 border-purple-200",
  transactional: "bg-amber-50 text-amber-700 border-amber-200",
  informational: "bg-neutral-50 text-neutral-600 border-neutral-200",
};
