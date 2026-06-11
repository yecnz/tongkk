"""/convert·/preview/pdf 결과를 EC2 로컬 SQLite에 캐싱한다(stdlib sqlite3만 사용).

전역(사용자 무관) 캐시 — markdown은 파일 바이트+서버 설정에서만 파생되고, 같은 파일을
가진 사람만 같은 해시 키를 만들 수 있어 정보 유출 경로가 없다. 키 구성(파이프라인 버전·
설정 지문 포함)은 main.py가 책임진다.

모든 public 함수는 best-effort다: sqlite 오류가 나면 get은 None을 돌려주고 set은 조용히
무시한다(warning 로그만). 캐시 장애가 변환 요청 자체를 깨뜨리는 일이 절대 없어야 한다.
"""

import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

logger = logging.getLogger("tongkk")

DB_PATH = Path(os.getenv("CONVERT_CACHE_PATH") or Path(__file__).resolve().parent / "convert_cache.sqlite3")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


TTL_SECONDS = _env_int("CONVERT_CACHE_TTL_DAYS", 60) * 86400
PREVIEW_MAX_BYTES = _env_int("CONVERT_CACHE_PREVIEW_MAX_BYTES", 20 * 1024 * 1024)
PREVIEW_MAX_ROWS = _env_int("CONVERT_CACHE_PREVIEW_MAX_ROWS", 200)
_PRUNE_EVERY_WRITES = 100

_write_count = 0
_write_count_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    # 스레드풀에서 호출되므로 커넥션은 공유하지 않고 연산마다 짧게 연다.
    # timeout=5: 동시 변환 완료 시 쓰기 잠금 충돌(database is locked)을 busy wait로 흡수.
    return sqlite3.connect(DB_PATH, timeout=5)


def _init() -> None:
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS convert_results ("
            "key TEXT PRIMARY KEY, markdown TEXT NOT NULL, "
            "created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS visual_items ("
            "key TEXT PRIMARY KEY, section TEXT NOT NULL, "
            "created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS preview_pdfs ("
            "key TEXT PRIMARY KEY, pdf BLOB NOT NULL, "
            "created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)"
        )


def _prune(conn: sqlite3.Connection) -> None:
    cutoff = int(time.time()) - TTL_SECONDS
    for table in ("convert_results", "visual_items", "preview_pdfs"):
        conn.execute(f"DELETE FROM {table} WHERE last_used_at < ?", (cutoff,))
    # 프리뷰 블롭은 행당 수 MB라 TTL과 별개로 최근 사용순 상한을 둔다.
    conn.execute(
        "DELETE FROM preview_pdfs WHERE key NOT IN ("
        "SELECT key FROM preview_pdfs ORDER BY last_used_at DESC LIMIT ?)",
        (PREVIEW_MAX_ROWS,),
    )


def _maybe_prune(conn: sqlite3.Connection) -> None:
    global _write_count
    with _write_count_lock:
        _write_count += 1
        should_prune = _write_count % _PRUNE_EVERY_WRITES == 0
    if should_prune:
        _prune(conn)


def _get(table: str, column: str, key: str):
    try:
        with _connect() as conn:
            row = conn.execute(f"SELECT {column} FROM {table} WHERE key = ?", (key,)).fetchone()
            if row is None:
                return None
            conn.execute(f"UPDATE {table} SET last_used_at = ? WHERE key = ?", (int(time.time()), key))
            return row[0]
    except sqlite3.Error:
        logger.warning("변환 캐시 조회 실패(%s) — 캐시 없이 진행", table, exc_info=True)
        return None


def _set(table: str, column: str, key: str, value) -> None:
    try:
        now = int(time.time())
        with _connect() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {table} (key, {column}, created_at, last_used_at) VALUES (?, ?, ?, ?)",
                (key, value, now, now),
            )
            _maybe_prune(conn)
    except sqlite3.Error:
        logger.warning("변환 캐시 저장 실패(%s) — 결과는 정상 반환됨", table, exc_info=True)


def get_markdown(key: str) -> str | None:
    return _get("convert_results", "markdown", key)


def set_markdown(key: str, markdown: str) -> None:
    _set("convert_results", "markdown", key, markdown)


def get_visual_section(key: str) -> str | None:
    return _get("visual_items", "section", key)


def set_visual_section(key: str, section: str) -> None:
    _set("visual_items", "section", key, section)


def get_preview(key: str) -> bytes | None:
    return _get("preview_pdfs", "pdf", key)


def set_preview(key: str, pdf_bytes: bytes) -> None:
    if len(pdf_bytes) > PREVIEW_MAX_BYTES:
        return
    _set("preview_pdfs", "pdf", key, pdf_bytes)


try:
    _init()
    with _connect() as _conn:
        _prune(_conn)
except sqlite3.Error:
    logger.warning("변환 캐시 초기화 실패 — 캐시 없이 동작", exc_info=True)
