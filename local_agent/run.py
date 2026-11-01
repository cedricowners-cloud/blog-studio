#!/usr/bin/env python3
"""cwd 와 무관하게 동작하는 에이전트 런처.

`python -m local_agent.main` 은 sys.path[0] 이 패키지의 *부모* 디렉토리여야
동작한다. 즉 저장소 루트에서만 되고, local_agent/ 안에서 실행하면
`ModuleNotFoundError: No module named 'local_agent'` 로 죽는다.
(pyproject 가 package-mode = false 라 설치형 패키지가 아니다.)

이 파일은 __file__ 로 부모 경로를 직접 넣기 때문에 어느 위치에서 실행해도 된다.

    python local_agent/run.py            # 에이전트 상시 실행
    python local_agent/run.py --no-tray  # 포어그라운드 로그
    python local_agent/run.py pair       # 최초 페어링

어디서 실행해도 동일하게 동작한다:

    cd blog_studio    && ./local_agent/.venv/bin/python local_agent/run.py pair
    cd local_agent    && ./.venv/bin/python run.py pair
"""
from __future__ import annotations

import sys
from pathlib import Path

# 패키지 디렉토리의 부모를 import 경로에 올린다. cwd 가 아니라 이 파일의
# 실제 위치를 기준으로 하므로 어디서 실행해도 같다.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def _migrate_to_keychain() -> None:
    """passphrase 로 암호화된 파일의 세션을 OS 키체인으로 옮긴다.

    키체인에 있으면 TTY 입력이 필요 없어져 launchd 상주가 가능해진다.
    기존 페어링을 그대로 쓰므로 웹에서 새 토큰을 받을 필요가 없다.
    """
    import getpass

    from local_agent import secrets

    if not secrets.keychain_available():
        print("keyring 이 설치되지 않았습니다: pip install -r requirements.txt")
        sys.exit(1)

    if secrets.load_agent_auth_keychain():
        print("이미 키체인에 세션이 있습니다 — 옮길 것이 없습니다.")
        return

    if not secrets.AGENT_AUTH_PATH.exists():
        print("옮길 파일이 없습니다 (data/agent_auth.enc).")
        print("처음부터 페어링하세요:  ./local_agent/agent pair")
        sys.exit(1)

    secrets.set_passphrase(getpass.getpass("기존 로컬 passphrase: "))
    auth = secrets.load_agent_auth()
    if not auth or not auth.get("refresh_token"):
        print("복호화 실패 — passphrase 가 다릅니다.")
        sys.exit(1)

    if not secrets.save_agent_auth_keychain(
        auth["refresh_token"], auth.get("access_token")
    ):
        print("키체인 저장 실패.")
        sys.exit(1)

    # 원본은 남겨둔다. 키체인을 우선 읽으므로 충돌하지 않고, 되돌릴 수 있다.
    print(f"✓ 키체인으로 옮겼습니다 ({secrets.KEYRING_SERVICE})")
    print("  이제 passphrase 없이 실행됩니다. 원본 파일은 그대로 두었습니다.")
    print("  지우려면: rm local_agent/data/agent_auth.enc")


def _main() -> None:
    # 첫 인자로 서브커맨드, 나머지는 main 으로 그대로 넘긴다.
    sub = sys.argv[1] if len(sys.argv) > 1 else ""

    if sub == "pair":
        from local_agent.pairing import run_pair_cli

        run_pair_cli()
        return

    if sub == "migrate":
        _migrate_to_keychain()
        return

    from local_agent.main import main

    main()


if __name__ == "__main__":
    _main()
