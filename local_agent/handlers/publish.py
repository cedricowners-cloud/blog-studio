"""블로그 발행 handler — Supabase jobs(type=publish) 수신 시 호출됨."""
from __future__ import annotations

import logging
from typing import Any

from ..driver_pool import POOL
from ..lib.base_to_excel import write_blog_post

logger = logging.getLogger(__name__)


def run(payload: dict[str, Any]) -> dict[str, Any]:
    """payload = {account_name, title, body, tags, template_index?, stay_minutes?}"""
    account = payload.get("account_name")
    title = payload.get("title", "")
    body = payload.get("body", "")
    tags = payload.get("tags", []) or []
    template_index = payload.get("template_index")
    stay_minutes = int(payload.get("stay_minutes") or 15)

    if not account or not title or not body:
        raise ValueError("account_name, title, body 필수")

    with POOL.acquire(account) as driver:
        success = write_blog_post(
            driver, title, body, tags,
            template_index=template_index,
            stay_minutes=stay_minutes,
        )
    return {"success": bool(success)}
