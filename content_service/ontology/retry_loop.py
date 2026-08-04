"""공리 검증 실패 시 최대 N회 재시도.

1회차: build_full_prompt(input)
2~N회차: 실패 공리 번호·규칙을 피드백으로 프롬프트 뒤에 append
임계값 달성 or max_retries 초과 시 종료. 초과 시 needs_human_review=True.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .axiom_validator import AxiomValidation, validate
from .llm_client import GenerationResult, LLMClient
from .prompt_builder import BlogGenerationInput, build_full_prompt
from .response_parser import ParsedResponse, parse

logger = logging.getLogger(__name__)


@dataclass
class AttemptRecord:
    attempt: int
    parsed: ParsedResponse
    axiom: AxiomValidation
    duration_ms: int
    prompt_tokens: int | None
    completion_tokens: int | None


@dataclass
class LoopResult:
    final: ParsedResponse
    final_axiom: AxiomValidation
    attempts: list[AttemptRecord] = field(default_factory=list)
    final_attempt_number: int = 1
    needs_human_review: bool = False
    total_duration_ms: int = 0


def _build_feedback(prev_prompt: str, failed: list[dict], parsed: ParsedResponse) -> str:
    """이전 프롬프트 + 실패 공리 피드백을 합쳐 다음 시도용 프롬프트 생성."""
    feedback_lines = [
        "",
        "═══════════════════════════════════════════════",
        "[재작성 요청] — 직전 응답이 다음 공리를 충족하지 못했습니다",
        "═══════════════════════════════════════════════",
        "",
        "아래 공리 각각에 대해 본문을 **해당 부분만 최소한으로 보강**한 후,",
        "다시 전체 JSON 응답을 출력하세요. 다른 공리에 영향 없게 하세요.",
        "",
    ]
    for f in failed:
        feedback_lines.append(f"- 공리 {f.get('number')}: {f.get('rule')}")
        ev = f.get("evidence")
        if ev:
            feedback_lines.append(f"  (이전 근거: {ev})")
    feedback_lines.extend([
        "",
        "직전 본문:",
        "```",
        parsed.body[:4000],
        "```",
        "",
        "요구사항:",
        "- 실패 공리를 모두 충족하도록 본문을 보강 (줄임표·잘림 금지)",
        "- axiom_check.items 전체를 다시 작성 (누락 없이)",
        "- JSON 스키마 그대로 유지",
    ])
    return prev_prompt + "\n".join(feedback_lines)


def run(
    inp: BlogGenerationInput,
    client: LLMClient,
    max_retries: int | None = None,
    pass_threshold: float | None = None,
) -> LoopResult:
    """재시도 루프 본체."""
    max_retries = max_retries or inp.generation_options.max_retries
    pass_threshold = (
        pass_threshold
        if pass_threshold is not None
        else inp.generation_options.axiom_pass_threshold
    )

    prompt = build_full_prompt(inp)
    attempts: list[AttemptRecord] = []
    total_ms = 0

    best: AttemptRecord | None = None

    for i in range(1, max_retries + 2):  # 1회 + max_retries
        gen: GenerationResult = client.generate(prompt)
        total_ms += gen.duration_ms
        parsed = parse(gen.text)
        axiom = validate(parsed.axiom_check, method_id=inp.method_id)

        record = AttemptRecord(
            attempt=i,
            parsed=parsed,
            axiom=axiom,
            duration_ms=gen.duration_ms,
            prompt_tokens=gen.prompt_tokens,
            completion_tokens=gen.completion_tokens,
        )
        attempts.append(record)
        logger.info(
            "attempt %d: parse_ok=%s axioms=%d/%d (%.0f%%)",
            i, parsed.parse_ok, axiom.passed, axiom.total, axiom.pass_rate * 100,
        )

        if best is None or axiom.pass_rate > best.axiom.pass_rate:
            best = record

        if axiom.pass_rate >= pass_threshold and axiom.valid_structure:
            return LoopResult(
                final=parsed,
                final_axiom=axiom,
                attempts=attempts,
                final_attempt_number=i,
                needs_human_review=False,
                total_duration_ms=total_ms,
            )

        # 재시도 가능하면 피드백 추가
        if i <= max_retries and axiom.failed_items:
            prompt = _build_feedback(build_full_prompt(inp), axiom.failed_items, parsed)

    # 임계값 미달 — 가장 좋은 시도를 반환하되 review 플래그
    assert best is not None
    return LoopResult(
        final=best.parsed,
        final_axiom=best.axiom,
        attempts=attempts,
        final_attempt_number=best.attempt,
        needs_human_review=True,
        total_duration_ms=total_ms,
    )
