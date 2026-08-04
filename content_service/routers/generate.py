"""블로그 글 생성 라우터 — Ontology v2 Phase 1 + 2 (공리 검증 루프)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ontology import db_client, retry_loop
from ontology.llm_client import LLMClient, Provider
from ontology.prompt_builder import BlogGenerationInput

logger = logging.getLogger(__name__)

router = APIRouter()


class GenerateRequest(BaseModel):
    input: BlogGenerationInput
    provider: Provider = "gemini"
    model: str | None = None


class AttemptSummary(BaseModel):
    attempt: int
    parse_ok: bool
    axiom_total: int
    axiom_passed: int
    axiom_failed: int
    duration_ms: int


class GenerateResponse(BaseModel):
    provider: Provider
    model: str
    duration_ms: int
    final_attempt: int
    needs_human_review: bool
    parse_ok: bool
    parse_errors: list[str]
    mapping: dict
    titles: list[dict]
    body: str
    axiom_check: dict
    suggestions: dict
    meta: dict
    attempts: list[AttemptSummary]
    post_id: str | None = Field(default=None, description="Supabase blog_posts.id — DB 저장 성공 시")


@router.post("", response_model=GenerateResponse)
async def generate_blog_post(req: GenerateRequest):
    client = LLMClient(provider=req.provider, model=req.model)
    try:
        loop = retry_loop.run(req.input, client)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"프롬프트 파일 누락: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("generation loop 실패")
        raise HTTPException(status_code=502, detail=f"생성 실패: {e}")

    parsed = loop.final
    if not parsed.body:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "본문 파싱 실패",
                "parse_errors": parsed.parse_errors,
                "attempts": len(loop.attempts),
            },
        )

    # Supabase 저장 (실패해도 응답은 정상 반환)
    result_dict = parsed.to_dict()
    inp_dict = req.input.model_dump()
    post_id = db_client.save_generation(
        inp=inp_dict,
        result=result_dict,
        provider=req.provider,
        duration_ms=loop.total_duration_ms,
        final_attempt=loop.final_attempt_number,
        needs_human_review=loop.needs_human_review,
    )
    if post_id:
        db_client.save_axiom_attempts(
            post_id,
            [
                {
                    "attempt": a.attempt,
                    "method_id": req.input.method_id,
                    "axiom_check": a.parsed.axiom_check,
                }
                for a in loop.attempts
            ],
        )

    return GenerateResponse(
        provider=req.provider,
        model=client.model,
        duration_ms=loop.total_duration_ms,
        final_attempt=loop.final_attempt_number,
        needs_human_review=loop.needs_human_review,
        parse_ok=parsed.parse_ok,
        parse_errors=parsed.parse_errors,
        mapping=parsed.mapping,
        titles=parsed.titles,
        body=parsed.body,
        axiom_check=parsed.axiom_check,
        suggestions=parsed.suggestions,
        meta=parsed.meta,
        attempts=[
            AttemptSummary(
                attempt=a.attempt,
                parse_ok=a.parsed.parse_ok,
                axiom_total=a.axiom.total,
                axiom_passed=a.axiom.passed,
                axiom_failed=a.axiom.failed,
                duration_ms=a.duration_ms,
            )
            for a in loop.attempts
        ],
        post_id=post_id,
    )
