"""Offline regressions for request amplification and provider error disclosure."""
import asyncio
import io
from unittest.mock import AsyncMock

import httpx
import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import auth
import main


@pytest.mark.parametrize("selection", ["1-1000000000000", "1000000000000-1"])
def test_page_ranges_are_rejected_before_expansion(monkeypatch, selection):
    def forbidden_range(*_):
        pytest.fail("An unbounded page range was expanded")

    monkeypatch.setattr(main, "range", forbidden_range, raising=False)
    with pytest.raises(HTTPException) as exc:
        main._parse_page_selection(selection)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("selection", ["1-6000,6001-12000", "1," * 2001])
def test_page_selection_has_total_and_input_limits(selection):
    with pytest.raises(HTTPException) as exc:
        main._parse_page_selection(selection)
    assert exc.value.status_code == 400


def test_normal_page_ranges_keep_existing_behavior():
    assert main._parse_page_selection("5-3,8,2") == {2, 3, 4, 5, 8}


def test_image_validation_selects_only_the_expected_decoder(monkeypatch):
    image = io.BytesIO()
    Image.new("RGB", (2, 2)).save(image, format="PNG")
    original = Image.open
    decoders = []

    def tracked_open(*args, **kwargs):
        decoders.append(kwargs.get("formats"))
        return original(*args, **kwargs)

    monkeypatch.setattr(Image, "open", tracked_open)
    main._validate_upload_content(image.getvalue(), ".png")
    assert decoders == [["PNG"]]
    with pytest.raises(HTTPException) as exc:
        main._validate_upload_content(image.getvalue(), ".jpg")
    assert exc.value.status_code == 400


def test_tiny_pdf_with_enormous_page_never_allocates_a_pixmap(tmp_path, monkeypatch):
    path = tmp_path / "oversized-page.pdf"
    with fitz.open() as document:
        document.new_page(width=100_000, height=100_000)
        document.save(path)
    assert path.stat().st_size < 2_000

    def forbidden_pixmap(*_, **__):
        pytest.fail("Unbounded PDF raster allocation was attempted")

    monkeypatch.setattr(fitz.Page, "get_pixmap", forbidden_pixmap)
    with pytest.raises(ValueError, match="PDF"):
        main._render_pdf_pages_for_visual_analysis(str(path), force=True)


@pytest.fixture
def auth_upstream(monkeypatch):
    monkeypatch.setattr(auth, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(auth, "SUPABASE_ANON_KEY", "anon-test")
    connection = AsyncMock()
    upstream = connection.__aenter__.return_value.get
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_: connection)
    return upstream


@pytest.mark.parametrize("body", [{}, [], {"id": ""}, {"id": 1}, {"id": " "}])
def test_auth_fails_closed_on_missing_identity(auth_upstream, body):
    auth_upstream.return_value = httpx.Response(200, json=body)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_api_user("Bearer user-token"))
    assert exc.value.status_code == 503


def test_auth_network_failure_never_returns_exception_text(auth_upstream):
    auth_upstream.side_effect = httpx.ConnectError("https://internal-host/path?secret=private-secret")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_api_user("Bearer user-token"))
    assert exc.value.status_code == 503
    assert "private-secret" not in exc.value.detail
    assert "internal-host" not in exc.value.detail


def test_auth_handles_malformed_json(auth_upstream):
    auth_upstream.return_value = httpx.Response(200, text="not-json private-secret")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_api_user("Bearer user-token"))
    assert exc.value.status_code == 503
    assert "private-secret" not in exc.value.detail


def test_auth_requires_success_status_and_preserves_valid_identity(auth_upstream):
    auth_upstream.return_value = httpx.Response(302, json={"id": "user-id"})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_api_user("Bearer user-token"))
    assert exc.value.status_code == 401
    auth_upstream.return_value = httpx.Response(200, json={"id": "user-id"})
    assert asyncio.run(auth.require_api_user("Bearer user-token")) == {"id": "user-id"}


@pytest.fixture
def client():
    main.app.dependency_overrides[main.require_api_user] = lambda: {"id": "user-id"}
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.pop(main.require_api_user, None)


def test_preview_never_returns_converter_exception_text(client, monkeypatch):
    monkeypatch.setattr(main, "_validate_upload_content", lambda *_: None)
    monkeypatch.setattr(main.convert_cache, "get_preview", lambda *_: None)

    def failed_conversion(*_):
        raise RuntimeError("/private/server/path private-secret")

    monkeypatch.setattr(main, "_convert_presentation_to_pdf", failed_conversion)
    response = client.post("/preview/pdf", files={"file": ("sample.pptx", b"test")})
    assert response.status_code == 503
    assert "private-secret" not in response.text
    assert "/private/server/path" not in response.text


@pytest.mark.parametrize("body", [
    {"error": {"message": "provider private-secret"}},
    {"responses": [{"error": {"message": "provider private-secret"}}]},
    {"responses": "invalid private-secret"}, [],
])
def test_ocr_provider_errors_are_sanitized(client, monkeypatch, body):
    monkeypatch.setattr(main, "GOOGLE_VISION_API_KEY", "fake-key")
    connection = AsyncMock()
    connection.__aenter__.return_value.post.return_value = httpx.Response(200, json=body)
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **_: connection)
    image = io.BytesIO()
    Image.new("RGB", (2, 2)).save(image, format="PNG")
    response = client.post("/vision/ocr", files={"file": ("sample.png", image.getvalue(), "image/png")})
    assert response.status_code == 502
    assert "private-secret" not in response.text
