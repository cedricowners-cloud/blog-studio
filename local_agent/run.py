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


def _main() -> None:
    # 첫 인자가 pair 면 페어링 CLI, 나머지는 main 으로 그대로 넘긴다.
    if len(sys.argv) > 1 and sys.argv[1] == "pair":
        from local_agent.pairing import run_pair_cli

        run_pair_cli()
        return

    from local_agent.main import main

    main()


if __name__ == "__main__":
    _main()
