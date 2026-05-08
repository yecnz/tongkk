import os
import sqlite3
import time
from pathlib import Path
from typing import Any
from uuid import uuid4


SERVER_DIR = Path(__file__).resolve().parent


def _database_path() -> Path:
    configured_path = os.getenv("DATABASE_PATH")
    if not configured_path:
        return SERVER_DIR / "tongkk.sqlite3"

    path = Path(configured_path)
    if path.is_absolute():
        return path
    return SERVER_DIR / path


def _connect() -> sqlite3.Connection:
    database_path = _database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS materials (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                name TEXT NOT NULL,
                size INTEGER,
                type TEXT NOT NULL,
                pages INTEGER,
                slides INTEGER,
                markdown TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_materials_course_id
            ON materials(course_id);

            CREATE TABLE IF NOT EXISTS summaries (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                template TEXT NOT NULL,
                content TEXT NOT NULL,
                material_ids TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_summaries_course_id
            ON summaries(course_id);

            CREATE TABLE IF NOT EXISTS quiz_sets (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                title TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                question_type TEXT NOT NULL,
                count INTEGER NOT NULL,
                material_ids TEXT NOT NULL,
                questions TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_quiz_sets_course_id
            ON quiz_sets(course_id);
            """
        )


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def list_courses() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM courses
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_course(course_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, created_at, updated_at FROM courses WHERE id = ?",
            (course_id,),
        ).fetchone()
    return _row_to_dict(row)


def create_course(name: str, now_ms: int) -> dict[str, Any]:
    course_id = str(uuid4())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO courses (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (course_id, name, now_ms, now_ms),
        )
    course = get_course(course_id)
    if course is None:
        raise RuntimeError("과목 생성 후 데이터를 불러오지 못했습니다.")
    return course


def update_course_name(course_id: str, name: str, now_ms: int) -> dict[str, Any] | None:
    with _connect() as conn:
        cursor = conn.execute(
            """
            UPDATE courses
            SET name = ?, updated_at = ?
            WHERE id = ?
            """,
            (name, now_ms, course_id),
        )
        if cursor.rowcount == 0:
            return None
    return get_course(course_id)


def delete_course(course_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
        return cursor.rowcount > 0


def list_materials(course_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, course_id, name, size, type, pages, slides, markdown, created_at, updated_at
            FROM materials
            WHERE course_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            (course_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_material(material_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, course_id, name, size, type, pages, slides, markdown, created_at, updated_at
            FROM materials
            WHERE id = ?
            """,
            (material_id,),
        ).fetchone()
    return _row_to_dict(row)


def create_material(
    *,
    material_id: str | None = None,
    course_id: str,
    name: str,
    size: int | None,
    material_type: str,
    pages: int | None,
    slides: int | None,
    markdown: str,
    now_ms: int,
) -> dict[str, Any]:
    current_material_id = material_id or str(uuid4())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO materials (
                id, course_id, name, size, type, pages, slides, markdown, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                current_material_id,
                course_id,
                name,
                size,
                material_type,
                pages,
                slides,
                markdown,
                now_ms,
                now_ms,
            ),
        )
        conn.execute(
            "UPDATE courses SET updated_at = ? WHERE id = ?",
            (now_ms, course_id),
        )
    material = get_material(current_material_id)
    if material is None:
        raise RuntimeError("자료 생성 후 데이터를 불러오지 못했습니다.")
    return material


def delete_material(material_id: str) -> bool:
    with _connect() as conn:
        material = conn.execute(
            "SELECT course_id FROM materials WHERE id = ?",
            (material_id,),
        ).fetchone()
        cursor = conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        if material and cursor.rowcount > 0:
            now_ms = int(time.time() * 1000)
            conn.execute(
                "UPDATE courses SET updated_at = ? WHERE id = ?",
                (now_ms, material["course_id"]),
            )
        return cursor.rowcount > 0


def list_summaries(course_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, course_id, template, content, material_ids, created_at, updated_at
            FROM summaries
            WHERE course_id = ?
            ORDER BY created_at DESC
            """,
            (course_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_summary(
    *,
    course_id: str,
    template: str,
    content: str,
    material_ids: str,
    now_ms: int,
) -> dict[str, Any]:
    with _connect() as conn:
        existing = conn.execute(
            """
            SELECT id FROM summaries
            WHERE course_id = ? AND template = ? AND material_ids = ?
            """,
            (course_id, template, material_ids),
        ).fetchone()

        if existing:
            summary_id = existing["id"]
            conn.execute(
                """
                UPDATE summaries
                SET content = ?, updated_at = ?
                WHERE id = ?
                """,
                (content, now_ms, summary_id),
            )
        else:
            summary_id = str(uuid4())
            conn.execute(
                """
                INSERT INTO summaries (
                    id, course_id, template, content, material_ids, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (summary_id, course_id, template, content, material_ids, now_ms, now_ms),
            )

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, course_id, template, content, material_ids, created_at, updated_at
            FROM summaries
            WHERE id = ?
            """,
            (summary_id,),
        ).fetchone()
    result = _row_to_dict(row)
    if result is None:
        raise RuntimeError("요약 저장 후 데이터를 불러오지 못했습니다.")
    return result


def delete_summary(summary_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM summaries WHERE id = ?", (summary_id,))
        return cursor.rowcount > 0


def list_quiz_sets(course_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, course_id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at
            FROM quiz_sets
            WHERE course_id = ?
            ORDER BY created_at DESC
            """,
            (course_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_quiz_set(
    *,
    course_id: str,
    title: str,
    difficulty: str,
    question_type: str,
    count: int,
    material_ids: str,
    questions: str,
    now_ms: int,
) -> dict[str, Any]:
    quiz_set_id = str(uuid4())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO quiz_sets (
                id, course_id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                quiz_set_id,
                course_id,
                title,
                difficulty,
                question_type,
                count,
                material_ids,
                questions,
                now_ms,
                now_ms,
            ),
        )

    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, course_id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at
            FROM quiz_sets
            WHERE id = ?
            """,
            (quiz_set_id,),
        ).fetchone()
    result = _row_to_dict(row)
    if result is None:
        raise RuntimeError("퀴즈 저장 후 데이터를 불러오지 못했습니다.")
    return result


def delete_quiz_set(quiz_set_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM quiz_sets WHERE id = ?", (quiz_set_id,))
        return cursor.rowcount > 0
