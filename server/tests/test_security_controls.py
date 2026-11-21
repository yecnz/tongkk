import io
import zipfile

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import login_attempts
import main


class _AuthResponse:
    def __init__(self, status_code: int, body: dict | None = None):
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


class _AuthClient:
    def __init__(self, response: _AuthResponse):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


def _office_zip(member: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr(member, "<document />")
    return output.getvalue()


def test_login_is_locked_after_five_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(login_attempts, "DB_PATH", tmp_path / "attempts.sqlite3")
    monkeypatch.setattr(login_attempts, "LOGIN_MAX_FAILURES", 5)
    monkeypatch.setattr(login_attempts, "LOGIN_LOCK_SECONDS", 900)
    login_attempts._init()

    key = login_attempts.account_key("Student@Example.com")
    for _ in range(4):
        assert login_attempts.retry_after_seconds(key, now=1_000) == 0
        assert login_attempts.record_failure(key, now=1_000) == 0
    assert login_attempts.retry_after_seconds(key, now=1_000) == 0
    assert login_attempts.record_failure(key, now=1_000) == 900
    assert login_attempts.retry_after_seconds(key, now=1_001) == 899

    login_attempts.clear_failures(key)
    assert login_attempts.retry_after_seconds(key, now=1_001) == 0


def test_login_account_key_does_not_store_email_and_is_case_insensitive():
    key = login_attempts.account_key(" Student@Example.com ")
    assert key == login_attempts.account_key("student@example.com")
    assert "student" not in key


def test_login_endpoint_locks_on_fifth_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(login_attempts, "DB_PATH", tmp_path / "route-attempts.sqlite3")
    login_attempts._init()
    monkeypatch.setattr(main, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(main, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **_kwargs: _AuthClient(_AuthResponse(400)),
    )
    client = TestClient(main.app)

    for _ in range(4):
        response = client.post("/auth/login", json={"email": "student@example.com", "password": "wrong"})
        assert response.status_code == 401
    response = client.post("/auth/login", json={"email": "student@example.com", "password": "wrong"})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"


def test_upload_content_checks_real_document_type():
    main._validate_upload_content(b"prefix%PDF-1.7\n", ".pdf")
    main._validate_upload_content(_office_zip("word/document.xml"), ".docx")
    main._validate_upload_content(_office_zip("ppt/presentation.xml"), ".pptx")

    with pytest.raises(HTTPException) as exc:
        main._validate_upload_content(b"not a pdf", ".pdf")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        main._validate_upload_content(_office_zip("word/document.xml"), ".pptx")
    assert exc.value.status_code == 400


def test_upload_rejects_archive_path_traversal():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
        archive.writestr("../outside.txt", "bad")

    with pytest.raises(HTTPException) as exc:
        main._validate_upload_content(output.getvalue(), ".docx")
    assert exc.value.status_code == 400
