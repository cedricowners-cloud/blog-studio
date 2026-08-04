"""서로이웃 신청 handler."""
from __future__ import annotations

import logging
from typing import Any

from ..driver_pool import POOL
from ..lib.neighbor_manager import process_neighbor_keyword

logger = logging.getLogger(__name__)


def run(payload: dict[str, Any]) -> dict[str, Any]:
    """payload = {account_name, keyword, max_count?, message}"""
    account = payload.get("account_name")
    keyword = payload.get("keyword", "")
    max_count = int(payload.get("max_count") or 20)
    message = payload.get("message", "")
    if not account or not keyword:
        raise ValueError("account_name, keyword 필수")

    with POOL.acquire(account, mobile=True) as driver:
        result = process_neighbor_keyword(driver, keyword, max_count, message)
    return result
