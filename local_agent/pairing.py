"""웹에서 발급한 Supabase refresh token을 받아 로컬에 암호화 저장.

CLI 흐름:
  1) 사용자가 웹 /agent 에서 "페어링 값 보기" → Supabase 세션 export
  2) 여기에 JSON({access_token, refresh_token}) 혹은 refresh token만 붙여넣기
  3) passphrase 입력 → data/agent_auth.enc 저장
"""
from __future__ import annotations

import getpass
import json
import sys

from . import secrets


def run_pair_cli() -> None:
    print("=== blog_studio Local Agent Pairing ===")
    pw = getpass.getpass("로컬 passphrase (없으면 새로 설정): ")
    if not pw:
        print("passphrase 비워둘 수 없습니다.")
        sys.exit(1)
    secrets.set_passphrase(pw)

    print(
        "\n웹 설정 페이지에서 생성된 페어링 페이로드를 붙여넣고 Enter:\n"
        "(access_token+refresh_token JSON 또는 refresh_token 한 줄)"
    )
    payload = sys.stdin.readline().strip()
    if not payload:
        print("입력 없음.")
        sys.exit(1)

    access_token: str | None = None
    refresh_token: str | None = None
    try:
        data = json.loads(payload)
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
    except json.JSONDecodeError:
        refresh_token = payload

    if not refresh_token:
        print("refresh_token 을 찾지 못했습니다.")
        sys.exit(1)

    secrets.save_agent_auth(refresh_token, access_token)
    agent_id = secrets.get_or_create_agent_id()
    print(f"\n✓ 저장됨. agent_id = {agent_id}")
    print("  이제 저장소 루트에서 에이전트를 실행하세요:")
    print("    ./local_agent/.venv/bin/python -m local_agent.main")


if __name__ == "__main__":
    run_pair_cli()
