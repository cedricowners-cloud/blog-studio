"""로컬 에이전트 엔트리포인트.

실행은 `agent` 래퍼를 쓴다 — 호출 위치와 무관하게 동작한다.

  ./local_agent/agent            # 트레이 + worker
  ./local_agent/agent --no-tray  # 포어그라운드
  ./local_agent/agent pair       # 페어링 CLI

`-m local_agent.main` 도 되지만 **저장소 루트에서만** 된다. local_agent/ 안에서
돌리면 sys.path[0] 이 local_agent/ 가 되어 패키지를 못 찾고
`ModuleNotFoundError: No module named 'local_agent'` 로 죽는다.
"""
from __future__ import annotations

import argparse
import getpass
import logging
import sys
import threading
from pathlib import Path

from . import secrets
from .driver_pool import POOL
from .worker import AgentWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("local_agent")


def _ensure_passphrase():
    # 첫 실행 여부 감지 — data/.salt 있으면 기존 사용자, 없으면 신규
    is_new = not secrets.SALT_PATH.exists()
    if is_new:
        print("최초 실행 — 로컬 passphrase 를 설정합니다 (계정 암호화용).")
        pw = getpass.getpass("새 passphrase: ")
        pw2 = getpass.getpass("확인: ")
        if not pw or pw != pw2:
            print("passphrase 불일치.")
            sys.exit(1)
        secrets.set_passphrase(pw)
        # 토큰 없으면 페어링 필요
        print(
            "passphrase 설정 완료. 이제 페어링이 필요합니다:\n"
            "  ./local_agent/agent pair"
        )
        sys.exit(0)
    else:
        pw = getpass.getpass("로컬 passphrase: ")
        secrets.set_passphrase(pw)
        if secrets.load_agent_auth() is None:
            print(
                "페어링 정보 없음 — 먼저 실행하세요:\n"
                "  ./local_agent/agent pair"
            )
            sys.exit(1)


def _run_tray(worker: AgentWorker):
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError:
        logger.warning("pystray 미설치 — 포어그라운드 모드로 실행합니다.")
        worker.start()
        return

    # 간단한 16x16 아이콘 생성 (설치 시 icon.png 로 교체 가능)
    icon_path = Path(__file__).parent / "assets" / "icon.png"
    if icon_path.exists():
        image = Image.open(icon_path)
    else:
        image = Image.new("RGB", (64, 64), "#FF5DA2")
        d = ImageDraw.Draw(image)
        d.rectangle((16, 16, 48, 48), fill="white")

    stop_event = threading.Event()

    def on_exit(icon, item):  # noqa: ARG001
        worker.stop()
        POOL.close_all()
        stop_event.set()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(lambda _: f"agent_id: {worker.agent_id[:8]}", None, enabled=False),
        pystray.MenuItem("종료", on_exit),
    )
    icon = pystray.Icon("blog_studio_agent", image, "blog_studio agent", menu)

    def run_worker():
        worker.start()

    threading.Thread(target=run_worker, daemon=True).start()
    icon.run()


def main():
    parser = argparse.ArgumentParser(description="blog_studio local agent")
    parser.add_argument("--no-tray", action="store_true", help="포어그라운드 모드 (개발용)")
    args = parser.parse_args()

    _ensure_passphrase()
    worker = AgentWorker()

    if args.no_tray:
        try:
            worker.start()
        except KeyboardInterrupt:
            logger.info("중단됨")
        finally:
            worker.stop()
            POOL.close_all()
    else:
        _run_tray(worker)


if __name__ == "__main__":
    main()
