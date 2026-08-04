/**
 * Strategy Recommender (Ontology v2)
 *
 * 입력: (level, intent, jtbd) 3축 좌표
 * 출력: 6개 방식 중 최적 추천 + 점수표 + reasoning
 *
 * 명세: Ontology STP·4C integration spec §7-2
 *
 * 점수 룰:
 *  - level 매칭: +3
 *  - intent 매칭: +2
 *  - jtbd 매칭: +2
 *  - 동점 시 우선순위: crank_info > insight_edge > alcon_mic > 나머지
 */
import type { SearchIntent, JtbdType } from "./prompt-builder";

export type AwarenessLevel = "L1" | "L2" | "L3" | "L4";

export interface StrategyMapping {
  method_id: number;
  code: string;
  label: string;
  levels: AwarenessLevel[];
  intents: SearchIntent[];
  jtbds: JtbdType[];
  /** 동점 시 우선순위 (낮을수록 우선) */
  tie_breaker: number;
}

export const STRATEGY_MAPPINGS: StrategyMapping[] = [
  {
    method_id: 1,
    code: "crank_dia",
    label: "C랭크 다이아플러스",
    levels: ["L1", "L2"],
    intents: ["정보탐색", "자격진단"],
    jtbds: ["시간절약", "자기효능감"],
    tie_breaker: 4,
  },
  {
    method_id: 2,
    code: "alcon_mic",
    label: "알콘",
    levels: ["L2", "L3"],
    intents: ["비교선택"],
    jtbds: ["의사결정지원"],
    tie_breaker: 3,
  },
  {
    method_id: 3,
    code: "aeo_brief",
    label: "AEO",
    levels: ["L1", "L2"],
    intents: ["정보탐색"],
    jtbds: ["시간절약"],
    tie_breaker: 5,
  },
  {
    method_id: 4,
    code: "homefeed",
    label: "홈피드",
    levels: ["L1"],
    intents: ["정보탐색"],
    jtbds: ["자기효능감"],
    tie_breaker: 6,
  },
  {
    method_id: 5,
    code: "insight_edge",
    label: "인사이트 엣지",
    levels: ["L4"],
    intents: ["문제해결"],
    jtbds: ["리스크회피"],
    tie_breaker: 2,
  },
  {
    method_id: 6,
    code: "crank_info",
    label: "C랭크 정보성",
    levels: ["L2", "L3"],
    intents: ["자격진단", "절차해결"],
    jtbds: ["리스크회피", "위임판단"],
    tie_breaker: 1,
  },
];

export interface RecommendInput {
  level: AwarenessLevel;
  intent?: SearchIntent | null;
  jtbd?: JtbdType | null;
}

export interface ScoredStrategy {
  method_id: number;
  code: string;
  label: string;
  score: number;
  matched: { level: boolean; intent: boolean; jtbd: boolean };
}

export interface Recommendation {
  recommended_method_id: number;
  recommended_code: string;
  recommended_label: string;
  reasoning: string;
  scores: ScoredStrategy[]; // 6개 모두, 점수 내림차순
}

/**
 * 6개 방식에 점수 매겨 최고 점수 추천.
 * intent / jtbd 가 미지정이면 그 축은 점수 0 (level만으로 매칭).
 */
export function recommendStrategy(input: RecommendInput): Recommendation {
  const scored: ScoredStrategy[] = STRATEGY_MAPPINGS.map((m) => {
    const levelMatch = m.levels.includes(input.level);
    const intentMatch = input.intent ? m.intents.includes(input.intent) : false;
    const jtbdMatch = input.jtbd ? m.jtbds.includes(input.jtbd) : false;
    let score = 0;
    if (levelMatch) score += 3;
    if (intentMatch) score += 2;
    if (jtbdMatch) score += 2;
    return {
      method_id: m.method_id,
      code: m.code,
      label: m.label,
      score,
      matched: { level: levelMatch, intent: intentMatch, jtbd: jtbdMatch },
    };
  });

  // 점수 내림차순 정렬, 동점 시 tie_breaker 작은 게 우선
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tA = STRATEGY_MAPPINGS.find((m) => m.method_id === a.method_id)!.tie_breaker;
    const tB = STRATEGY_MAPPINGS.find((m) => m.method_id === b.method_id)!.tie_breaker;
    return tA - tB;
  });

  const top = scored[0];
  const reasoning = buildReasoning(top, input);

  return {
    recommended_method_id: top.method_id,
    recommended_code: top.code,
    recommended_label: top.label,
    reasoning,
    scores: scored,
  };
}

function buildReasoning(top: ScoredStrategy, input: RecommendInput): string {
  const parts: string[] = [];
  if (top.matched.level) parts.push(`인지단계 ${input.level}`);
  if (top.matched.intent && input.intent) parts.push(`검색의도 "${input.intent}"`);
  if (top.matched.jtbd && input.jtbd) parts.push(`JTBD "${input.jtbd}"`);

  if (parts.length === 0) {
    return `좌표가 어느 방식과도 강하게 매칭되지 않음 — 폴백으로 ${top.label} 추천`;
  }
  return `${parts.join(", ")} 매칭으로 ${top.label}(${top.code}) 추천 (점수 ${top.score})`;
}
