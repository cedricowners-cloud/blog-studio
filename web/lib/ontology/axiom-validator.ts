/**
 * 공리 검증 — 3카테고리 분리 (algorithm / 4c / brand_voice).
 *
 * 1. algorithm: LLM 자체 axiom_check (방식 1~6 prompts에 정의된 공통 10 + 방식 특화)
 * 2. 4c: Customer Value / Cost / Convenience / Communication (#11~14)
 *        - LLM 자체 평가 + 본문 패턴 매칭으로 이중 검증
 * 3. brand_voice: differentiating_benefit 별 자동 활성화 BV 공리
 *        - LLM이 self-report 한 결과 우선
 */
import type { DomainPack } from "./domain-loader";

export type AxiomCategory = "algorithm" | "4c" | "brand_voice";

export interface AxiomFailedItem {
  number?: number;
  rule: string;
  evidence?: string;
  category?: AxiomCategory;
}

export interface AxiomCategoryResult {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  failed_items: AxiomFailedItem[];
}

export interface AxiomValidation {
  // 합산 (호환용)
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  failed_items: AxiomFailedItem[];
  valid_structure: boolean;
  notes: string[];
  // 카테고리별 분리
  by_category: {
    algorithm: AxiomCategoryResult;
    fourC: AxiomCategoryResult;
    brand_voice: AxiomCategoryResult;
  };
}

// 방식별 예상 공리 총 개수 (공통 10 + 방식특화)
const EXPECTED_ALGORITHM_TOTALS: Record<number, number> = { 1: 15, 2: 16, 3: 16, 4: 16, 5: 16, 6: 17 };

interface AxiomItem {
  number?: number;
  rule?: string;
  passed?: boolean;
  evidence?: string;
  category?: string;
}

function emptyCategory(): AxiomCategoryResult {
  return { total: 0, passed: 0, failed: 0, pass_rate: 0, failed_items: [] };
}

function classifyItem(it: AxiomItem): AxiomCategory {
  // 1) item 자체 category 라벨이 있으면 우선
  if (it.category === "4c" || it.category === "brand_voice" || it.category === "algorithm") {
    return it.category;
  }
  // 2) number 범위로 추정 — 11~14 = 4C, 그 외 숫자 = algorithm, BV는 LLM이 별도 표기 필요
  if (typeof it.number === "number" && it.number >= 11 && it.number <= 14) return "4c";
  // 3) rule 텍스트에 "BV" 또는 "Brand Voice" 포함 → brand_voice
  if (it.rule && /(BV\d|Brand Voice|브랜드 보이스)/i.test(it.rule)) return "brand_voice";
  return "algorithm";
}

/**
 * 본문에서 4C 공리 #11, #12를 추가로 검증 (LLM self-report 보정).
 * #13, #14는 LLM 평가에 의존 (구조 검사가 마크다운/네이버태그 다양성으로 까다로움).
 */
function verify4CAgainstBody(
  body: string,
  pack: DomainPack | null | undefined,
): { axiomNumber: number; passed: boolean; evidence: string }[] {
  const out: { axiomNumber: number; passed: boolean; evidence: string }[] = [];
  if (!pack) return out;

  const head100 = body.slice(0, 200); // 첫 100자 의도 — 약간 여유 줘서 200자로
  const headFirstScreen = body.slice(0, 400); // "첫 화면" 의도 — 약 400자 (모바일 1뷰)

  // #11 — value_proposition_pattern 안의 *고정 텍스트 부분*이 첫 100자 안에 등장
  const vpp = pack.positioning.value_proposition_pattern;
  if (vpp) {
    // 패턴에서 {...} 슬롯을 제외한 고정 부분 (앞부분)
    const fixedPart = vpp.split("{")[0]?.trim() ?? "";
    const fixedTail = vpp.split("}")[1]?.trim() ?? "";
    const passed = (fixedPart.length > 5 && head100.includes(fixedPart)) ||
                   (fixedTail.length > 5 && head100.includes(fixedTail));
    out.push({
      axiomNumber: 11,
      passed,
      evidence: passed ? `첫 100자 안에 "${fixedPart}" 패턴 발견` : `첫 100자에 가치명제 누락`,
    });
  }

  // #12 — core_answer_type 키워드가 첫 화면(첫 400자) 안에 등장
  const cat = pack.positioning.core_answer_type;
  if (cat && cat.length > 1) {
    const passed = headFirstScreen.includes(cat);
    out.push({
      axiomNumber: 12,
      passed,
      evidence: passed ? `첫 화면에 "${cat}" 발견` : `첫 화면에 "${cat}" 미발견`,
    });
  }

  return out;
}

/**
 * Brand Voice 공리 검증 — LLM의 self-report (axiom_check.items의 BV 항목) 우선.
 * 항목이 없으면 활성 BV 개수만큼 'pending'으로 fail 처리해 재시도 유도.
 */
function evaluateBrandVoice(
  axiomCheck: Record<string, unknown>,
  pack: DomainPack | null | undefined,
): AxiomCategoryResult {
  const result = emptyCategory();
  if (!pack) return result;

  const itemsRaw = (axiomCheck.items as AxiomItem[] | undefined) ?? [];
  const bvItems = itemsRaw.filter((it) => classifyItem(it) === "brand_voice");
  const expected = pack.activeBrandVoiceAxioms.length;

  if (bvItems.length === 0 && expected > 0) {
    // LLM이 BV 항목을 출력 안 함 → 모두 fail
    result.total = expected;
    result.failed = expected;
    result.failed_items = pack.activeBrandVoiceAxioms.map((rule, i) => ({
      number: 100 + i,
      rule,
      evidence: "LLM이 Brand Voice 공리를 self-report 하지 않음",
      category: "brand_voice" as const,
    }));
    return result;
  }

  let passed = 0;
  for (const it of bvItems) {
    if (it.passed) {
      passed++;
    } else {
      result.failed_items.push({
        number: it.number,
        rule: it.rule ?? "",
        evidence: it.evidence ?? "",
        category: "brand_voice",
      });
    }
  }
  result.total = bvItems.length;
  result.passed = passed;
  result.failed = bvItems.length - passed;
  result.pass_rate = bvItems.length > 0 ? passed / bvItems.length : 0;
  return result;
}

export function validate(
  axiomCheck: Record<string, unknown>,
  methodId?: number,
  body?: string,
  domainPack?: DomainPack | null,
): AxiomValidation {
  const notes: string[] = [];
  const itemsRaw = axiomCheck.items;

  // 카테고리별 결과 컨테이너
  const algo = emptyCategory();
  const four = emptyCategory();

  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    notes.push("axiom_check.items 누락 또는 빈 배열");
    return {
      total: 0,
      passed: 0,
      failed: 0,
      pass_rate: 0,
      failed_items: [],
      valid_structure: false,
      notes,
      by_category: { algorithm: algo, fourC: four, brand_voice: emptyCategory() },
    };
  }

  // 1) LLM self-report 항목 분류 (algorithm / 4c / brand_voice)
  for (const it of itemsRaw as AxiomItem[]) {
    if (typeof it !== "object" || it === null) continue;
    const cat = classifyItem(it);
    const target = cat === "4c" ? four : cat === "brand_voice" ? null : algo;
    if (target === null) continue; // brand_voice는 evaluateBrandVoice에서 별도 처리

    target.total++;
    if (it.passed) {
      target.passed++;
    } else {
      target.failed++;
      target.failed_items.push({
        number: it.number,
        rule: it.rule ?? "",
        evidence: it.evidence ?? "",
        category: cat,
      });
    }
  }
  algo.pass_rate = algo.total > 0 ? algo.passed / algo.total : 0;
  four.pass_rate = four.total > 0 ? four.passed / four.total : 0;

  // 2) 4C 본문 추가 검증 (#11, #12) — LLM self-report 와 OR 결합
  if (body && domainPack) {
    const bodyResults = verify4CAgainstBody(body, domainPack);
    for (const br of bodyResults) {
      const existingIdx = four.failed_items.findIndex((f) => f.number === br.axiomNumber);
      if (br.passed && existingIdx >= 0) {
        // LLM은 fail이라 했지만 본문엔 있음 → pass로 보정
        four.failed_items.splice(existingIdx, 1);
        four.failed--;
        four.passed++;
      } else if (!br.passed && existingIdx < 0 && four.total > 0) {
        // LLM은 pass라 했지만 본문엔 없음 → fail로 보정
        const ruleMap: Record<number, string> = {
          11: "Customer Value (가치명제 첫 100자)",
          12: "Cost (핵심답 첫 화면)",
        };
        four.failed_items.push({
          number: br.axiomNumber,
          rule: ruleMap[br.axiomNumber] ?? `4C #${br.axiomNumber}`,
          evidence: br.evidence,
          category: "4c",
        });
        four.failed++;
        four.passed = Math.max(0, four.passed - 1);
      }
    }
    four.pass_rate = four.total > 0 ? four.passed / four.total : 0;
  }

  // 3) Brand Voice — 별도 evaluator
  const bv = evaluateBrandVoice(axiomCheck, domainPack);

  // 4) 알고리즘 공리 수 검증
  if (methodId !== undefined && EXPECTED_ALGORITHM_TOTALS[methodId] !== undefined) {
    const expected = EXPECTED_ALGORITHM_TOTALS[methodId];
    if (algo.total < expected) {
      notes.push(`알고리즘 공리 수 부족: ${algo.total}/${expected} (방식 ${methodId} 예상)`);
    }
  }

  // 5) 합산
  const totalAll = algo.total + four.total + bv.total;
  const passedAll = algo.passed + four.passed + bv.passed;
  const failedAll = algo.failed + four.failed + bv.failed;
  const allFailed: AxiomFailedItem[] = [
    ...algo.failed_items,
    ...four.failed_items,
    ...bv.failed_items,
  ];

  return {
    total: totalAll,
    passed: passedAll,
    failed: failedAll,
    pass_rate: totalAll > 0 ? passedAll / totalAll : 0,
    failed_items: allFailed,
    valid_structure: true,
    notes,
    by_category: { algorithm: algo, fourC: four, brand_voice: bv },
  };
}
