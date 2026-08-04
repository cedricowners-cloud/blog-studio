"""로컬 에이전트 메인 루프 — Supabase jobs 테이블을 폴링해서 처리.

Realtime 구독도 가능하지만 Python SDK에서는 아직 베타. 신뢰성을 위해
3초 폴링을 기본으로 사용. 향후 Realtime 추가 시 중복 처리 방지 필요.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from dotenv import load_dotenv

from .handlers import interact, neighbor, publish
from .secrets import get_or_create_agent_id, load_agent_auth

logger = logging.getLogger(__name__)

load_dotenv()

HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "publish": publish.run,
    "neighbor_add": neighbor.run,
    "interact_like": interact.run,
    "interact_comment": interact.run,
}

POLL_INTERVAL_SEC = int(os.getenv("AGENT_POLL_INTERVAL", "3"))
HEARTBEAT_INTERVAL_SEC = int(os.getenv("AGENT_HEARTBEAT_INTERVAL", "30"))


def _get_supabase_client():
    """사용자 refresh token 기반으로 auth 세션 부착된 클라이언트 반환."""
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    anon = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon:
        raise RuntimeError("SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 비어있습니다.")

    sb = create_client(url, anon)

    auth = load_agent_auth()
    if auth and auth.get("refresh_token"):
        try:
            sb.auth.set_session(
                access_token=auth.get("access_token") or "",
                refresh_token=auth["refresh_token"],
            )
        except Exception as e:
            logger.warning("set_session 실패 — refresh 시도: %s", e)
            try:
                sb.auth.refresh_session(auth["refresh_token"])
            except Exception:
                logger.exception("refresh_session 도 실패 — QR 페어링 필요")
    return sb


class AgentWorker:
    def __init__(self):
        self.agent_id = get_or_create_agent_id()
        self.sb = _get_supabase_client()
        self._stop = threading.Event()
        self._hb_thread: threading.Thread | None = None

    def start(self):
        logger.info("AgentWorker 시작 — agent_id=%s", self.agent_id)
        self._hb_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._hb_thread.start()

        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("tick 실패 — 계속 진행")
            self._stop.wait(POLL_INTERVAL_SEC)

    def stop(self):
        self._stop.set()

    def _heartbeat_loop(self):
        while not self._stop.is_set():
            try:
                self._send_heartbeat("idle")
            except Exception:
                logger.exception("heartbeat 실패")
            self._stop.wait(HEARTBEAT_INTERVAL_SEC)

    def _send_heartbeat(self, status: str):
        self.sb.table("agent_heartbeat").upsert(
            {
                "agent_id": self.agent_id,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "status": status,
                "version": "0.1.0",
            },
            on_conflict="agent_id",
        ).execute()

    def _tick(self):
        """pending jobs 한 개 픽업 → 처리 → 상태 업데이트."""
        # 내 계정이 등록된 job만 취득 (RLS + 단일 사용자 기준)
        res = (
            self.sb.table("jobs")
            .select("*")
            .eq("status", "pending")
            .order("created_at")
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return
        job = rows[0]
        self._process_job(job)

    def _process_job(self, job: dict[str, Any]):
        job_id = job["id"]
        job_type = job["type"]
        logger.info("job 수신: %s (id=%s)", job_type, job_id)

        # claim: running 으로 먼저 update. 이미 다른 에이전트가 잡았으면 0 rows affected
        claim = (
            self.sb.table("jobs")
            .update(
                {
                    "status": "running",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "agent_id": self.agent_id,
                }
            )
            .eq("id", job_id)
            .eq("status", "pending")
            .execute()
        )
        if not claim.data:
            logger.info("다른 에이전트가 먼저 잡음 — 스킵 %s", job_id)
            return

        self._log(job_id, "info", f"작업 시작 ({job_type})")
        self._send_heartbeat("busy")

        handler = HANDLERS.get(job_type)
        if handler is None:
            self._complete(job_id, "failed", error=f"알 수 없는 job type: {job_type}")
            self._send_heartbeat("idle")
            return

        try:
            result = handler(job["payload"] or {})
            self._log(job_id, "info", "완료")
            self._complete(job_id, "completed", result=result)
        except Exception as e:
            logger.exception("job 처리 실패 %s", job_id)
            self._log(job_id, "error", f"실패: {e}")
            self._complete(job_id, "failed", error=str(e))
        finally:
            self._send_heartbeat("idle")

    def _log(self, job_id: str, level: str, message: str):
        try:
            self.sb.table("job_logs").insert(
                {"job_id": job_id, "level": level, "message": message}
            ).execute()
        except Exception:
            logger.exception("job_logs insert 실패")

    def _complete(
        self,
        job_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ):
        update: dict[str, Any] = {
            "status": status,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if result is not None:
            update["result"] = result
        if error is not None:
            update["error_message"] = error
        self.sb.table("jobs").update(update).eq("id", job_id).execute()
