"""계정별 seleniumbase UC 드라이버 풀. 동시 실행 방지 + 재사용."""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Iterator

from .lib.base_to_excel import login_naver

logger = logging.getLogger(__name__)


class DriverPool:
    def __init__(self):
        self._drivers: dict[str, object] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._global_lock = threading.Lock()

    def _lock_for(self, account: str) -> threading.Lock:
        with self._global_lock:
            if account not in self._locks:
                self._locks[account] = threading.Lock()
            return self._locks[account]

    @contextmanager
    def acquire(self, account: str, headless: bool = False, mobile: bool = False) -> Iterator[object]:
        """계정별 드라이버를 블로킹 획득. 같은 계정 요청은 직렬화됨."""
        lock = self._lock_for(account)
        lock.acquire()
        driver = None
        try:
            driver = self._drivers.get(account)
            if driver is None:
                logger.info("[%s] UC 드라이버 신규 생성", account)
                driver = login_naver(headless=headless, account_name=account, mobile=mobile)
                if not driver:
                    raise RuntimeError(f"{account} 로그인 실패")
                self._drivers[account] = driver
            else:
                # 세션 살아있는지 간단 체크
                try:
                    _ = driver.current_url
                except Exception:
                    logger.warning("[%s] 드라이버 세션 만료 — 재생성", account)
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    driver = login_naver(headless=headless, account_name=account, mobile=mobile)
                    if not driver:
                        raise RuntimeError(f"{account} 재로그인 실패")
                    self._drivers[account] = driver
            yield driver
        finally:
            lock.release()

    def close(self, account: str) -> None:
        driver = self._drivers.pop(account, None)
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass

    def close_all(self) -> None:
        for acc in list(self._drivers.keys()):
            self.close(acc)


POOL = DriverPool()
