"""Supabase 에 생성 결과·공리 로그를 저장. 저장 실패는 생성 플로우를 막지 않음."""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_client = None


def get_client():
    global _client
    if _client is not None:
        return _client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.warning("SUPABASE_URL / SERVICE_ROLE_KEY 미설정 — DB 저장 비활성화")
        return None
    try:
        from supabase import create_client
        _client = create_client(url, key)
        return _client
    except Exception as e:
        logger.exception("Supabase 클라이언트 초기화 실패: %s", e)
        return None


def save_generation(
    *,
    inp: dict,
    result: dict,
    provider: str,
    duration_ms: int,
    final_attempt: int,
    needs_human_review: bool,
) -> str | None:
    """blog_posts insert 후 id 반환. 실패 시 None."""
    sb = get_client()
    if sb is None:
        return None

    axiom = result.get("axiom_check") or {}
    row: dict[str, Any] = {
        "method_id": inp.get("method_id"),
        "topic": inp.get("topic"),
        "main_keyword": inp.get("main_keyword"),
        "sub_keywords": inp.get("sub_keywords") or [],
        "target_awareness_level": inp.get("target_awareness_level"),
        "persona": inp.get("persona"),
        "title": (result.get("titles") or [{}])[0].get("title") if result.get("titles") else None,
        "body": result.get("body"),
        "body_char_count": len(result.get("body") or ""),
        "content_type": (result.get("meta") or {}).get("content_type"),
        "axiom_total": axiom.get("total"),
        "axiom_passed": axiom.get("passed"),
        "axiom_failed": axiom.get("failed"),
        "axiom_pass_rate": axiom.get("pass_rate"),
        "axiom_failed_list": axiom.get("failed_rules") or [],
        "final_attempt": final_attempt,
        "needs_human_review": needs_human_review,
        "llm_provider": provider,
        "generation_duration_ms": duration_ms,
        "meta": result.get("meta") or {},
    }

    try:
        res = sb.table("blog_posts").insert(row).execute()
        return res.data[0]["id"] if res.data else None
    except Exception as e:
        logger.exception("blog_posts insert 실패: %s", e)
        return None


def save_axiom_attempts(post_id: str, attempts: list[dict]) -> None:
    """attempts 각 시도의 axiom items 개별 로그 저장."""
    sb = get_client()
    if sb is None or not post_id:
        return
    rows: list[dict[str, Any]] = []
    for attempt in attempts:
        attempt_num = attempt.get("attempt")
        axiom = attempt.get("axiom_check") or {}
        items = axiom.get("items") or []
        for it in items:
            rows.append({
                "post_id": post_id,
                "method_id": attempt.get("method_id"),
                "axiom_number": it.get("number"),
                "axiom_rule": it.get("rule", ""),
                "passed": bool(it.get("passed")),
                "evidence": it.get("evidence"),
                "attempt_number": attempt_num,
            })
    if not rows:
        return
    try:
        sb.table("axiom_stats").insert(rows).execute()
    except Exception as e:
        logger.exception("axiom_stats insert 실패: %s", e)
