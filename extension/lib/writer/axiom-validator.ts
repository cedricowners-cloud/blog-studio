// 글쓰기 방식의 통과 조건(공리)을 센다. AI가 스스로 점검한 결과를 모은다.
// 웹의 web/lib/ontology/axiom-validator.ts 를 옮긴 것이다.
// 업종 설정이 있을 때만 도는 부분(본문 대조, 브랜드 보이스 강제)은 아직 없다. 업종 설정을 넣을 때 같이 옮긴다.
// 업종 설정이 없을 때의 결과가 웹과 같은지는 tests/parity.test.ts 가 확인한다.

export type AxiomCategory = 'algorithm' | '4c' | 'brand_voice';

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
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  failed_items: AxiomFailedItem[];
  valid_structure: boolean;
  notes: string[];
  by_category: {
    algorithm: AxiomCategoryResult;
    fourC: AxiomCategoryResult;
    brand_voice: AxiomCategoryResult;
  };
}

/** 방식마다 있어야 하는 공리 수 (공통 10 + 방식별) */
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
  if (it.category === '4c' || it.category === 'brand_voice' || it.category === 'algorithm') return it.category;
  if (typeof it.number === 'number' && it.number >= 11 && it.number <= 14) return '4c';
  if (it.rule && /(BV\d|Brand Voice|브랜드 보이스)/i.test(it.rule)) return 'brand_voice';
  return 'algorithm';
}

export function validate(axiomCheck: Record<string, unknown>, methodId?: number): AxiomValidation {
  const notes: string[] = [];
  const itemsRaw = axiomCheck.items;
  const algo = emptyCategory();
  const four = emptyCategory();

  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    notes.push('axiom_check.items 누락 또는 빈 배열');
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

  for (const it of itemsRaw as AxiomItem[]) {
    if (typeof it !== 'object' || it === null) continue;
    const cat = classifyItem(it);
    // 브랜드 보이스 항목은 업종 설정이 있을 때만 센다. 지금은 건너뛴다 (웹도 업종 없이는 세지 않는다).
    const target = cat === '4c' ? four : cat === 'brand_voice' ? null : algo;
    if (target === null) continue;

    target.total++;
    if (it.passed) {
      target.passed++;
    } else {
      target.failed++;
      target.failed_items.push({ number: it.number, rule: it.rule ?? '', evidence: it.evidence ?? '', category: cat });
    }
  }
  algo.pass_rate = algo.total > 0 ? algo.passed / algo.total : 0;
  four.pass_rate = four.total > 0 ? four.passed / four.total : 0;

  const bv = emptyCategory();

  if (methodId !== undefined) {
    const expected = EXPECTED_ALGORITHM_TOTALS[methodId];
    if (expected !== undefined && algo.total < expected) {
      notes.push(`알고리즘 공리 수 부족: ${algo.total}/${expected} (방식 ${methodId} 예상)`);
    }
  }

  const totalAll = algo.total + four.total + bv.total;
  const passedAll = algo.passed + four.passed + bv.passed;
  const failedAll = algo.failed + four.failed + bv.failed;

  return {
    total: totalAll,
    passed: passedAll,
    failed: failedAll,
    pass_rate: totalAll > 0 ? passedAll / totalAll : 0,
    failed_items: [...algo.failed_items, ...four.failed_items, ...bv.failed_items],
    valid_structure: true,
    notes,
    by_category: { algorithm: algo, fourC: four, brand_voice: bv },
  };
}
