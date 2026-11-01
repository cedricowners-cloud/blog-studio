"""로컬 에이전트 메인 루프 — Supabase jobs 테이블을 폴링해서 처리.

Realtime 구독도 가능하지만 Python SDK에서는 아직 베타. 신뢰성을 위해
3초 폴링을 기본으로 사용. 향후 Realtime 추가 시 중복 처리 방지 필요.
"""
from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from dotenv import dotenv_values, load_dotenv

from .handlers import interact, neighbor, publish
from .secrets import get_or_create_agent_id, load_agent_auth_any

logger = logging.getLogger(__name__)

load_dotenv()

LogFn = Callable[[str, str], None]

# 핸들러는 (payload, on_log=...) 를 받아 결과 dict 를 돌려준다.
HANDLERS: dict[str, Callable[..., dict[str, Any]]] = {
    "publish": publish.run,
    "neighbor_add": neighbor.run,
    "interact_like": interact.run,
    "interact_comment": interact.run,
}

POLL_INTERVAL_SEC = int(os.getenv("AGENT_POLL_INTERVAL", "3"))
HEARTBEAT_INTERVAL_SEC = int(os.getenv("AGENT_HEARTBEAT_INTERVAL", "30"))


# 같은 저장소 안에 이미 동일한 값이 다른 이름으로 들어있다.
# 사용자가 같은 값을 또 적게 만들지 않도록 아래 순서로 찾는다.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_FALLBACK_ENV_FILES = (
    _REPO_ROOT / ".env",
    _REPO_ROOT / "web" / ".env.local",
    _REPO_ROOT / "content_service" / ".env",
)
_URL_NAMES = ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
_ANON_NAMES = ("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")


def _resolve_supabase_config() -> tuple[str, str]:
    """URL + anon key 를 여러 이름·위치에서 찾는다.

    환경변수(또는 local_agent/.env)가 우선이고, 없으면 저장소 안의 다른
    .env 파일을 뒤진다. anon key 는 설계상 공개 키라(브라우저 번들에
    그대로 실린다) 이렇게 공유해도 노출 위험이 늘지 않는다.

    주의: 필요한 두 값만 골라 읽는다. 파일 전체를 os.environ 에 올리면
    SUPABASE_SERVICE_ROLE_KEY 같은 무관한 비밀까지 에이전트 프로세스로
    끌려 들어온다.
    """

    def pick(names: tuple[str, ...], source) -> str | None:
        for n in names:
            v = source(n)
            if v:
                return v
        return None

    url = pick(_URL_NAMES, os.getenv)
    anon = pick(_ANON_NAMES, os.getenv)

    for path in _FALLBACK_ENV_FILES:
        if url and anon:
            break
        if not path.is_file():
            continue
        values = dotenv_values(path)
        url = url or pick(_URL_NAMES, values.get)
        anon = anon or pick(_ANON_NAMES, values.get)
        logger.debug("%s 에서 Supabase 설정 보충", path)

    if not url or not anon:
        missing = []
        if not url:
            missing.append("SUPABASE_URL")
        if not anon:
            missing.append("SUPABASE_ANON_KEY")
        raise RuntimeError(
            f"{' / '.join(missing)} 를 찾을 수 없습니다. "
            f"local_agent/.env 에 넣거나 환경변수로 지정하세요. "
            f"(탐색한 파일: {', '.join(str(p) for p in _FALLBACK_ENV_FILES)})"
        )
    return url, anon


class AuthRequired(RuntimeError):
    """페어링이 없거나 만료돼 Supabase 세션을 붙일 수 없음."""


_REPAIR_HINT = (
    "웹 /agent 에서 '페어링 값 보기' 로 새 값을 받아 다시 페어링하세요:\n"
    "  ./local_agent/agent pair"
)


def _get_supabase_client():
    """사용자 refresh token 으로 세션을 붙인 클라이언트 반환.

    세션 부착에 실패하면 **반드시 예외를 던진다.** 과거엔 경고만 찍고
    익명 클라이언트를 돌려줬는데, 그러면 jobs 폴링이 RLS 때문에 빈 결과를
    HTTP 200 으로 받아서 "작업이 없는 정상 상태"와 구분되지 않는다.
    에이전트는 영원히 아무 일도 안 하면서 살아있는 것처럼 보인다.
    """
    from supabase import create_client

    url, anon = _resolve_supabase_config()
    sb = create_client(url, anon)

    # 키체인 → 암호화 파일 순으로 찾는다.
    auth, source = load_agent_auth_any()
    if not auth or not auth.get("refresh_token"):
        if source == "file":
            # load_agent_auth() 는 "파일 없음"과 "복호화 실패"를 모두 None 으로
            # 돌려준다. 구분하지 않으면 passphrase 오타가 "페어링 안 됨"으로
            # 보여서 멀쩡한 페어링을 다시 하게 만든다.
            raise AuthRequired(
                "저장된 페어링 정보를 복호화할 수 없습니다 — passphrase 가 "
                "다릅니다.\n"
                "passphrase 를 잊었다면 처음부터 설정하세요:\n"
                "  rm -rf local_agent/data && ./local_agent/agent pair"
            )
        raise AuthRequired(f"아직 페어링하지 않았습니다.\n{_REPAIR_HINT}")
    logger.info("페어링 정보 출처: %s", source)

    try:
        sb.auth.set_session(
            access_token=auth.get("access_token") or "",
            refresh_token=auth["refresh_token"],
        )
    except Exception as e:
        # access_token 이 만료됐으면 set_session 이 실패하는 게 정상이다.
        logger.info("저장된 access_token 사용 불가 — refresh 시도 (%s)", e)
        try:
            sb.auth.refresh_session(auth["refresh_token"])
        except Exception as e2:
            raise AuthRequired(
                f"저장된 페어링 값으로 로그인할 수 없습니다: {e2}\n"
                f"세션이 만료됐거나 폐기된 경우입니다.\n{_REPAIR_HINT}"
            ) from e2

    return sb


def _local_account_labels() -> list[str]:
    """이 기기가 쿠키를 가진 계정 라벨 목록.

    login_naver 는 ID/PW 가 아니라 data/cookies/naver_<라벨>.json 으로
    로그인하므로, 쿠키 파일이 곧 "이 기기가 바로 처리할 수 있는 계정"이다.
    AGENT_ACCOUNTS 환경변수(쉼표 구분)로 수동 지정도 가능.
    """
    override = os.getenv("AGENT_ACCOUNTS", "").strip()
    if override:
        return [a.strip() for a in override.split(",") if a.strip()]

    from .lib.base_to_excel import COOKIE_DIR

    try:
        names = []
        for fname in os.listdir(COOKIE_DIR):
            if fname.startswith("naver_") and fname.endswith(".json"):
                names.append(fname[len("naver_") : -len(".json")])
        return sorted(names)
    except FileNotFoundError:
        return []


def ensure_webdriver() -> None:
    """uc_driver 를 미리 내려받아 둔다.

    seleniumbase 는 드라이버가 없으면 Driver() 호출 시점에 다운로드하는데,
    그 다운로드가 끝나는 동안 띄운 Chrome 세션이 깨진다. 최초 발행이

      Warning: uc_driver not found. Getting it now: ...
      → no such window: target window already closed

    로 실패했던 원인이다. 작업을 받기 전에 끝내둔다.
    """
    import seleniumbase

    driver_path = (
        Path(seleniumbase.__file__).parent / "drivers" / "uc_driver"
    )
    if driver_path.exists():
        return

    logger.info("uc_driver 가 없습니다 — 작업 수신 전에 미리 설치합니다.")
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "seleniumbase", "get", "uc_driver"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if driver_path.exists():
            logger.info("uc_driver 설치 완료")
        else:
            logger.warning(
                "uc_driver 선행 설치 실패 — 첫 발행이 실패할 수 있습니다. %s",
                (proc.stderr or proc.stdout or "").strip()[:200],
            )
    except Exception:
        logger.exception("uc_driver 선행 설치 중 오류 — 첫 발행이 실패할 수 있습니다.")


class AgentWorker:
    def __init__(self):
        self.agent_id = get_or_create_agent_id()
        self.sb = _get_supabase_client()
        self.user_id = self._resolve_user_id()
        self.label = os.getenv("AGENT_LABEL") or platform.node() or "로컬 에이전트"
        self._stop = threading.Event()
        self._hb_thread: threading.Thread | None = None

    def _resolve_user_id(self) -> str:
        """세션 실사용 검증 + 하트비트 소유자 식별.

        set_session 이 통과해도 토큰이 실제로 유효하다는 보장은 없으므로
        여기서 한 번 서버에 물어본다. user_id 는 agent_heartbeat RLS 가
        요구하는 값이라, None 이면 하트비트가 영구히 42501 로 실패한다.
        그래서 경고가 아니라 중단으로 처리한다.
        """
        try:
            resp = self.sb.auth.get_user()
        except Exception as e:
            raise AuthRequired(
                f"세션 확인 실패: {e}\n{_REPAIR_HINT}"
            ) from e
        if not resp or not resp.user:
            raise AuthRequired(f"세션에 사용자 정보가 없습니다.\n{_REPAIR_HINT}")
        logger.info("Supabase 인증 확인 — user=%s", resp.user.email or resp.user.id)
        return resp.user.id

    def start(self):
        logger.info("AgentWorker 시작 — agent_id=%s", self.agent_id)
        # 작업을 받기 전에 끝내둬야 첫 발행이 다운로드와 경쟁하지 않는다.
        ensure_webdriver()
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
        # user_id / accounts / label 은 웹이 "에이전트 연결됨"과 발행 가능
        # 계정 목록을 보여주기 위해 필요하다. user_id 가 없으면 RLS
        # (agent_heartbeat_user_*) 에 걸려 upsert 자체가 거부된다.
        self.sb.table("agent_heartbeat").upsert(
            {
                "agent_id": self.agent_id,
                "user_id": self.user_id,
                "label": self.label,
                "accounts": _local_account_labels(),
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
            # 발행은 최소 15분 걸리므로 핸들러가 진행 상황을 job_logs 로
            # 흘려보내야 웹에서 상태를 볼 수 있다.
            result = handler(
                job["payload"] or {},
                on_log=lambda level, msg: self._log(job_id, level, msg),
            )
            if job_type == "publish":
                self._after_publish(job, result)
            self._log(job_id, "info", "완료")
            self._complete(job_id, "completed", result=result)
        except Exception as e:
            logger.exception("job 처리 실패 %s", job_id)
            self._log(job_id, "error", f"실패: {e}")
            self._complete(job_id, "failed", error=str(e))
        finally:
            self._send_heartbeat("idle")

    def _after_publish(self, job: dict[str, Any], result: dict[str, Any]):
        """발행 성공 후 이력 기록 + 원본 글에 발행 상태 반영.

        둘 다 실패해도 job 자체는 성공으로 남긴다 — 네이버에는 이미 올라갔고,
        여기서 예외를 던지면 job 이 failed 로 뒤집혀 "실패했는데 글은 올라간"
        더 나쁜 상태가 된다.
        """
        if not result.get("success"):
            return

        # 임시저장은 공개된 게 아니다. published_at 을 찍으면 웹에서
        # "발행됨" 으로 보이고 publish_history 에도 발행 이력이 남는다.
        if result.get("saved_as_draft"):
            self._log(
                job["id"],
                "info",
                "임시저장이므로 발행 이력·발행 상태는 기록하지 않습니다.",
            )
            return

        account = job.get("account_name")
        payload = job.get("payload") or {}
        post_url = result.get("post_url")
        title = payload.get("title", "")
        tags = payload.get("tags") or []
        blog_post_id = job.get("blog_post_id") or payload.get("blog_post_id")

        try:
            self.sb.table("publish_history").insert(
                {
                    "blog_post_id": blog_post_id,
                    "account_name": account,
                    "title": title,
                    "tags": tags,
                    "status": "success",
                    "naver_post_url": post_url,
                }
            ).execute()
        except Exception:
            logger.exception("publish_history 기록 실패 (발행 자체는 성공)")
            self._log(job["id"], "warn", "발행 이력 기록 실패 — 발행은 완료됨")

        if not blog_post_id:
            return
        try:
            self.sb.table("blog_posts").update(
                {
                    "published_at": datetime.now(timezone.utc).isoformat(),
                    "naver_post_url": post_url,
                }
            ).eq("id", blog_post_id).execute()
        except Exception:
            logger.exception("blog_posts 발행 상태 갱신 실패 (발행 자체는 성공)")
            self._log(job["id"], "warn", "글 발행 상태 갱신 실패 — 발행은 완료됨")

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
