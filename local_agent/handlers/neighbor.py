"""서로이웃 신청 handler."""
from __future__ import annotations

import logging
from typing import Any, Callable

from ..driver_pool import POOL
from ..lib.neighbor_manager import process_neighbor_keyword

logger = logging.getLogger(__name__)

LogFn = Callable[[str, str], None]


def _noop_log(level: str, message: str) -> None:
    pass


def run(payload: dict[str, Any], on_log: LogFn = _noop_log) -> dict[str, Any]:
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
