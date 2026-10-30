"""블로그 발행 handler — Supabase jobs(type=publish) 수신 시 호출됨."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

from ..driver_pool import POOL
from ..lib.base_to_excel import write_blog_post

logger = logging.getLogger(__name__)

LogFn = Callable[[str, str], None]


def _noop_log(level: str, message: str) -> None:
    pass


def _extract_post_url(driver) -> str | None:
    """발행 직후 주소에서 글 URL 추출.

    write_blog_post 는 성공 여부(bool)만 돌려주고 글 주소를 남기지 않는다.
    저장 후 네이버가 작성한 글로 이동하므로 current_url 을 best-effort 로 읽는다.
    실패해도 발행 자체는 성공이므로 None 을 돌려주고 넘어간다.
    """
    try:
        url = driver.current_url or ""
    except Exception:
        return None

    # 정상 발행 후: https://blog.naver.com/<id>/<logNo>
    if re.search(r"blog\.naver\.com/[^/]+/\d+", url):
        return url
    # 에디터/관리 페이지에 머물러 있으면 글 주소가 아니다.
    if "GoBlogWrite" in url or "Write" in url or "PostWriteForm" in url:
        return None
    return url or None


def run(payload: dict[str, Any], on_log: LogFn = _noop_log) -> dict[str, Any]:
    """payload = {account_name, title, body, tags, template_index?, stay_minutes?,
    blog_post_id?}"""
    account = payload.get("account_name")
    title = payload.get("title", "")
    body = payload.get("body", "")
    tags = payload.get("tags", []) or []
    template_index = payload.get("template_index")
    stay_minutes = int(payload.get("stay_minutes") or 15)

    if not account or not title or not body:
        raise ValueError("account_name, title, body 필수")

    on_log(
        "info",
        f"[{account}] 브라우저 준비 중 — 저장된 쿠키가 없으면 로그인 창이 "
        f"열립니다(180초 내 직접 로그인 필요).",
    )

    with POOL.acquire(account) as driver:
        on_log(
            "info",
            f"에디터에 글 작성 시작 — 제목 {len(title)}자 / 본문 {len(body)}자. "
            f"차단 회피를 위해 최소 {stay_minutes}분 체류합니다.",
        )
        success = write_blog_post(
            driver, title, body, tags,
            template_index=template_index,
            stay_minutes=stay_minutes,
        )
        post_url = _extract_post_url(driver) if success else None

    if success:
        on_log("info", f"발행 완료{f' — {post_url}' if post_url else ''}")
    else:
        # write_blog_post 는 내부 예외를 삼키고 False 를 돌려준다.
        on_log("error", "발행 실패 — 에디터 조작 중 문제가 발생했습니다.")

    return {"success": bool(success), "post_url": post_url}
