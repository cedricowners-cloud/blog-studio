"""계정 ID/PW + Supabase refresh token 로컬 암호화 저장.

키는 OS keychain 대신 기기 고유 정보 + 사용자 입력 passphrase 기반 Fernet 키.
Passphrase는 첫 실행 시 설정되며 data/.salt 에 salt만 보관 (비밀번호 자체는 저장 X).
"""
from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

ACCOUNTS_PATH = DATA_DIR / "accounts.enc"
SALT_PATH = DATA_DIR / ".salt"
AGENT_AUTH_PATH = DATA_DIR / "agent_auth.enc"
AGENT_ID_PATH = DATA_DIR / "agent.id"

logger = logging.getLogger(__name__)

_cached_fernet: Fernet | None = None


def _load_or_create_salt() -> bytes:
    if SALT_PATH.exists():
        return SALT_PATH.read_bytes()
    salt = os.urandom(16)
    SALT_PATH.write_bytes(salt)
    return salt


def derive_key(passphrase: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_load_or_create_salt(),
        iterations=390_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))


def set_passphrase(passphrase: str) -> None:
    """세션 동안 사용할 passphrase를 설정. 프로세스 종료 시 잊힘."""
    global _cached_fernet
    _cached_fernet = Fernet(derive_key(passphrase))


def _fernet() -> Fernet:
    if _cached_fernet is None:
        raise RuntimeError("passphrase 가 설정되지 않음. set_passphrase() 먼저 호출하세요.")
    return _cached_fernet


def save_accounts(accounts: list[dict[str, Any]]) -> None:
    blob = _fernet().encrypt(json.dumps(accounts, ensure_ascii=False).encode("utf-8"))
    ACCOUNTS_PATH.write_bytes(blob)


def load_accounts() -> list[dict[str, Any]]:
    if not ACCOUNTS_PATH.exists():
        return []
    try:
        plain = _fernet().decrypt(ACCOUNTS_PATH.read_bytes())
        return json.loads(plain.decode("utf-8"))
    except InvalidToken:
        logger.error("accounts.enc 복호화 실패 — passphrase 불일치")
        return []


def save_agent_auth(refresh_token: str, access_token: str | None = None) -> None:
    blob = _fernet().encrypt(
        json.dumps({"refresh_token": refresh_token, "access_token": access_token}).encode("utf-8")
    )
    AGENT_AUTH_PATH.write_bytes(blob)


def load_agent_auth() -> dict[str, str] | None:
    if not AGENT_AUTH_PATH.exists():
        return None
    try:
        return json.loads(_fernet().decrypt(AGENT_AUTH_PATH.read_bytes()).decode("utf-8"))
    except InvalidToken:
        return None


def get_or_create_agent_id() -> str:
    if AGENT_ID_PATH.exists():
        return AGENT_ID_PATH.read_text().strip()
    import uuid
    new_id = str(uuid.uuid4())
    AGENT_ID_PATH.write_text(new_id)
    return new_id
