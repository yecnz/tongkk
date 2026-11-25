import asyncio
import io
import wave
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import audio


def wav(seconds=1, channels=1, rate=16000):
    result = io.BytesIO()
    with wave.open(result, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b"\0\0" * (int(seconds * rate) * channels))
    return result.getvalue()


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(audio.router)
    app.dependency_overrides[audio.require_api_user] = lambda: {"id": "user"}
    provider = AsyncMock(return_value="검토할 강의 전사문")
    monkeypatch.setattr(audio, "get_transcription", provider)
    with TestClient(app) as instance:
        yield instance, provider, app


def test_transcribe_returns_text_and_measured_duration(client):
    client, provider, _ = client
    result = client.post("/audio/transcriptions", files={"file": ("x.wav", wav(2), "audio/wav")})
    assert result.status_code == 200
    assert result.json() == {"text": "검토할 강의 전사문", "duration_seconds": 2}
    provider.assert_awaited_once()


def test_audio_requires_a_real_user_even_with_development_auth_bypass(client):
    client, provider, app = client
    app.dependency_overrides[audio.require_api_user] = lambda: None
    assert client.post("/audio/transcriptions", files={"file": ("x.wav", wav(), "audio/wav")}).status_code == 401
    provider.assert_not_awaited()


@pytest.mark.parametrize("content,mime,status", [(b"not audio", "audio/wav", 422), (b"x", "audio/mp3", 415), (wav(channels=2), "audio/wav", 422), (wav(rate=8000), "audio/wav", 422), (wav()[:-10], "audio/wav", 422)], ids=["corrupt", "mime", "stereo", "sample-rate", "truncated"])
def test_invalid_audio_never_calls_provider(client, content, mime, status):
    client, provider, _ = client
    assert client.post("/audio/transcriptions", files={"file": ("x.wav", content, mime)}).status_code == status
    provider.assert_not_awaited()


def test_duration_is_checked_from_pcm_not_client_input(client, monkeypatch):
    client, provider, _ = client
    monkeypatch.setattr(audio, "MAX_SECONDS", 1)
    assert client.post("/audio/transcriptions", files={"file": ("x.wav", wav(2), "audio/wav")}, data={"duration": 0.1}).status_code == 422
    provider.assert_not_awaited()


def test_size_checked_before_provider(client, monkeypatch):
    client, provider, _ = client
    monkeypatch.setattr(audio, "MAX_BYTES", 100)
    assert client.post("/audio/transcriptions", files={"file": ("x.wav", wav(), "audio/wav")}).status_code == 413
    provider.assert_not_awaited()


def test_missing_key_does_not_call_sdk(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(audio.get_transcription(wav()))
    assert caught.value.status_code == 503


def test_sdk_is_server_only_no_automatic_retries_and_usage_recorded(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    create = AsyncMock(return_value=SimpleNamespace(text=" 문장 ", usage=SimpleNamespace(model_dump=lambda: {"input_tokens": 2, "output_tokens": 1})))
    sdk = MagicMock()
    sdk.return_value.__aenter__ = AsyncMock(return_value=SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create))))
    sdk.return_value.__aexit__ = AsyncMock(return_value=False)
    telemetry = MagicMock()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    monkeypatch.setattr(audio, "AsyncOpenAI", sdk)
    monkeypatch.setattr(audio, "record", telemetry)
    assert asyncio.run(audio.get_transcription(wav())) == "문장"
    assert sdk.call_args.kwargs["max_retries"] == 0
    assert create.call_args.kwargs["response_format"] == "json"
    assert telemetry.call_args.kwargs["feature"] == "audio_transcription"
    assert telemetry.call_args.kwargs["failed"] is False


def test_disconnect_watcher_exits_when_request_cancel_scope_swallows_cancellation():
    async def scenario():
        entered = asyncio.Event()
        finished = asyncio.Event()

        class Request:
            async def is_disconnected(self):
                entered.set()
                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    return False

        watcher = asyncio.create_task(audio.wait_for_disconnect(Request(), finished))
        await entered.wait()
        finished.set()
        watcher.cancel()
        await asyncio.wait_for(watcher, timeout=1)

    asyncio.run(scenario())
