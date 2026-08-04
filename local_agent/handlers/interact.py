"""이웃 좋아요/댓글 handler."""
from __future__ import annotations

import logging
from typing import Any

from ..driver_pool import POOL
from ..lib.blog_interact import process_neighbor_interaction

logger = logging.getLogger(__name__)


def run(payload: dict[str, Any]) -> dict[str, Any]:
    """payload = {account_name, max_pages, do_like, do_comment, comment_mode}"""
    account = payload.get("account_name")
    max_pages = int(payload.get("max_pages") or 3)
    do_like = bool(payload.get("do_like", True))
    do_comment = bool(payload.get("do_comment", False))
    comment_mode = payload.get("comment_mode", "template")
    if not account:
        raise ValueError("account_name 필수")

    with POOL.acquire(account, mobile=True) as driver:
        result = process_neighbor_interaction(
            driver, max_pages, do_like, do_comment, comment_mode, ai_generator=None,
        )
    return result
