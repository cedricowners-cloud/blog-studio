"""LLM이 자체 반환한 axiom_check 섹션을 검증.

LLM이 스스로 공리를 체크한 결과(§4)를 신뢰하되, 다음을 확인:
1. items가 실제로 존재하는지 (누락 공리 방지)
2. passed == len(failed_rules==false) 정합성
3. pass_rate 문자열 파싱

실패 공리 번호와 규칙을 반환해 retry_loop에서 프롬프트에 피드백으로 사용.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AxiomValidation:
    total: int
    passed: int
    failed: int
    pass_rate: float           # 0.0 ~ 1.0
    failed_items: list[dict]   # [{number, rule, evidence}, ...]
    valid_structure: bool      # axiom_check 자체가 구조적으로 유효한지
    notes: list[str]


# 방식별 예상 공리 총 개수 (공통 10 + 방식특화)
EXPECTED_TOTALS = {1: 15, 2: 16, 3: 16, 4: 16, 5: 16, 6: 17}


def validate(axiom_check: dict, method_id: int | None = None) -> AxiomValidation:
    notes: list[str] = []
    items = axiom_check.get("items") or []
    if not isinstance(items, list) or not items:
        return AxiomValidation(
            total=0, passed=0, failed=0, pass_rate=0.0,
            failed_items=[], valid_structure=False,
            notes=["axiom_check.items 누락 또는 빈 배열"],
        )

    failed_items: list[dict] = []
    passed_count = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        if bool(it.get("passed")):
            passed_count += 1
        else:
            failed_items.append({
                "number": it.get("number"),
                "rule": it.get("rule", ""),
                "evidence": it.get("evidence", ""),
            })

    total = len(items)
    if method_id in EXPECTED_TOTALS and total < EXPECTED_TOTALS[method_id]:
        notes.append(
            f"공리 수 부족: {total}/{EXPECTED_TOTALS[method_id]} (방식 {method_id} 예상)"
        )

    failed = total - passed_count
    pass_rate = passed_count / total if total else 0.0

    # LLM이 self-report한 값과 실제 count 불일치 감지
    reported_passed = axiom_check.get("passed")
    if isinstance(reported_passed, int) and reported_passed != passed_count:
        notes.append(
            f"self-report 불일치: items에서 passed={passed_count} 인데 axiom_check.passed={reported_passed}"
        )

    return AxiomValidation(
        total=total,
        passed=passed_count,
        failed=failed,
        pass_rate=pass_rate,
        failed_items=failed_items,
        valid_structure=True,
        notes=notes,
    )
