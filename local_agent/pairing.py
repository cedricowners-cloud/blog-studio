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


# 비정상 입력으로 무한 대기하지 않도록 상한을 둔다.
_MAX_LINES = 200
_MAX_CHARS = 200_000


def _read_payload() -> str:
    """페어링 페이로드를 읽는다. 여러 줄 JSON 붙여넣기를 지원.

    readline() 한 번만 읽으면 들여쓴 JSON 의 첫 줄 "{" 만 가져가고,
    그게 refresh_token 으로 저장된다(= 조용한 실패). 남은 줄은 셸로 흘러가
    `zsh: command not found: access_token:` 가 뜬다.
    """
    first = sys.stdin.readline()
    if not first:
        return ""

    buf = first.strip()
    # refresh_token 한 줄이면 그대로 끝.
    if not buf.startswith("{"):
        return buf

    # JSON 이면 완성될 때까지 더 읽는다.
    for _ in range(_MAX_LINES):
        try:
            json.loads(buf)
            return buf
        except json.JSONDecodeError:
            pass
        if len(buf) > _MAX_CHARS:
            break
        line = sys.stdin.readline()
        if not line:  # EOF — 불완전한 JSON. 호출자가 처리한다.
            break
        buf += line
    return buf


def _prompt_passphrase() -> str:
    """passphrase 입력. 최초 설정이면 확인까지 받는다.

    확인 없이 오타가 통과하면 그 오타가 곧 passphrase 가 되고, 다음 실행에서
    '복호화할 수 없습니다' 로 막혀 페어링을 처음부터 다시 해야 한다.
    """
    is_new = not secrets.SALT_PATH.exists()
    if not is_new:
        pw = getpass.getpass("로컬 passphrase: ")
        if not pw:
            print("passphrase 비워둘 수 없습니다.")
            sys.exit(1)
        return pw

    print("최초 설정 — 로컬 passphrase 를 정합니다 (이 PC의 토큰 암호화용).")
    pw = getpass.getpass("새 passphrase: ")
    if not pw:
        print("passphrase 비워둘 수 없습니다.")
        sys.exit(1)
    if pw != getpass.getpass("확인: "):
        print("passphrase 불일치.")
        sys.exit(1)
    return pw


def run_pair_cli() -> None:
    print("=== blog_studio Local Agent Pairing ===")
    pw = _prompt_passphrase()
    secrets.set_passphrase(pw)

    print(
        "\n웹 /agent 의 '페어링 값 보기' 에서 복사한 값을 붙여넣고 Enter:\n"
        "(JSON 여러 줄도 됩니다. refresh_token 한 줄만 넣어도 됩니다.)"
    )
    payload = _read_payload()
    if not payload:
        print("입력 없음.")
        sys.exit(1)

    access_token: str | None = None
    refresh_token: str | None = None
    if payload.startswith("{"):
        # JSON 을 넣었으면 파싱 실패를 refresh_token 으로 오인하면 안 된다.
        # 과거엔 여기서 "{" 가 토큰으로 저장돼 인증이 조용히 깨졌다.
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as e:
            print(f"JSON 파싱 실패: {e.msg} (위치 {e.pos})")
            print("웹의 '복사' 버튼으로 전체를 복사했는지 확인하세요.")
            sys.exit(1)
        if not isinstance(data, dict):
            print("JSON 최상위가 객체가 아닙니다.")
            sys.exit(1)
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
    else:
        refresh_token = payload

    if not refresh_token:
        print("refresh_token 을 찾지 못했습니다.")
        sys.exit(1)

    # refresh token 은 JWT 가 아닌 짧은 불투명 문자열이지만, 한 자리짜리
    # 쓰레기 값("{" 등)이 저장되는 건 막는다.
    if len(refresh_token) < 8:
        print(f"refresh_token 이 너무 짧습니다 ({refresh_token!r}). 복사가 잘렸는지 확인하세요.")
        sys.exit(1)

    secrets.save_agent_auth(refresh_token, access_token)
    agent_id = secrets.get_or_create_agent_id()
    print(f"\n✓ 저장됨. agent_id = {agent_id}")
    print("  이제 에이전트를 실행하세요:")
    print("    ./local_agent/agent")


if __name__ == "__main__":
    run_pair_cli()
