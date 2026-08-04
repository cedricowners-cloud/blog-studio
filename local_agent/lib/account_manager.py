"""다중 네이버 계정 관리 모듈"""
import os
import json
import logging

logger = logging.getLogger(__name__)

ACCOUNTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'accounts.json')


def _ensure_file():
    os.makedirs(os.path.dirname(ACCOUNTS_FILE), exist_ok=True)
    if not os.path.exists(ACCOUNTS_FILE):
        with open(ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
            json.dump([], f)


def load_accounts():
    """저장된 계정 목록 반환"""
    _ensure_file()
    try:
        with open(ACCOUNTS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"계정 로드 실패: {e}")
        return []


def save_accounts(accounts):
    """계정 목록 저장"""
    _ensure_file()
    try:
        with open(ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(accounts, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"계정 저장 실패: {e}")


def add_account(name, naver_id, naver_pw):
    """계정 추가"""
    accounts = load_accounts()
    if any(a['name'] == name for a in accounts):
        return False, "이미 존재하는 계정 이름입니다."
    if len(accounts) >= 10:
        return False, "최대 10개 계정까지 등록할 수 있습니다."
    accounts.append({
        'name': name,
        'naver_id': naver_id,
        'naver_pw': naver_pw,
    })
    save_accounts(accounts)
    logger.info(f"계정 추가: {name}")
    return True, "계정이 추가되었습니다."


def remove_account(name):
    """계정 삭제"""
    accounts = load_accounts()
    accounts = [a for a in accounts if a['name'] != name]
    save_accounts(accounts)
    logger.info(f"계정 삭제: {name}")


def update_account(name, naver_id=None, naver_pw=None):
    """계정 정보 수정"""
    accounts = load_accounts()
    for a in accounts:
        if a['name'] == name:
            if naver_id is not None:
                a['naver_id'] = naver_id
            if naver_pw is not None:
                a['naver_pw'] = naver_pw
            break
    save_accounts(accounts)


def get_account(name):
    """이름으로 계정 조회"""
    accounts = load_accounts()
    for a in accounts:
        if a['name'] == name:
            return a
    return None
