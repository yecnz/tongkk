"""로그인 실패 횟수를 서버 로컬 SQLite에 보관한다.

이메일 원문은 저장하지 않고 SHA-256 키만 사용한다. 단일 EC2 인스턴스에서 재시작 뒤에도
잠금이 유지되며, DB 오류가 나면 인증을 열어 주지 않고 일시적인 서버 오류로 처리한다.
"""

import hashlib
import sqlite3
import time
from pathlib import Path

from config import LOGIN_LOCK_SECONDS, LOGIN_MAX_FAILURES, LOGIN_ATTEMPTS_DB_PATH


DB_PATH = Path(LOGIN_ATTEMPTS_DB_PATH)


def _connect() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH, timeout=5)


def _init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS login_attempts ("
            "account_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, "
            "locked_until INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS login_attempts_updated_idx "
            "ON login_attempts (updated_at)"
        )


def account_key(email: str) -> str:
    normalized = email.strip().casefold().encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def retry_after_seconds(key: str, now: int | None = None) -> int:
    current = int(time.time()) if now is None else now
    with _connect() as conn:
        row = conn.execute(
            "SELECT locked_until FROM login_attempts WHERE account_hash = ?",
            (key,),
        ).fetchone()
        if row is None:
            return 0
        locked_until = int(row[0])
        if locked_until == 0:
            return 0
        if locked_until <= current:
            conn.execute("DELETE FROM login_attempts WHERE account_hash = ?", (key,))
            return 0
        return locked_until - current


def record_failure(key: str, now: int | None = None) -> int:
    current = int(time.time()) if now is None else now
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "DELETE FROM login_attempts WHERE updated_at < ? AND locked_until <= ?",
            (current - 86_400, current),
        )
        row = conn.execute(
            "SELECT failures, locked_until FROM login_attempts WHERE account_hash = ?",
            (key,),
        ).fetchone()
        failures = 0
        if row is not None and int(row[1]) > current:
            return int(row[1]) - current
        if row is not None and int(row[1]) == 0:
            failures = int(row[0])

        failures += 1
        locked_until = current + LOGIN_LOCK_SECONDS if failures >= LOGIN_MAX_FAILURES else 0
        conn.execute(
            "INSERT INTO login_attempts (account_hash, failures, locked_until, updated_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(account_hash) DO UPDATE SET "
            "failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at",
            (key, failures, locked_until, current),
        )
        return max(0, locked_until - current)


def clear_failures(key: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM login_attempts WHERE account_hash = ?", (key,))


_init()
