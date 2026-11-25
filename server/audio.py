"""Authenticated, bounded speech transcription; audio bytes are never persisted."""
import asyncio
import io
import os
import time
import wave

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from openai import AsyncOpenAI, APIError

from auth import require_api_user
from usage import record

router = APIRouter(prefix="/audio", tags=["audio"])
MAX_SECONDS = 600
MAX_BYTES = 20 * 1024 * 1024


def validate_wav(data: bytes) -> float:
    """Validate the actual PCM payload, never a client-supplied duration."""
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                raise ValueError("unsupported PCM")
            frames = audio.getnframes()
            seconds = frames / audio.getframerate()
            if not 0 < seconds <= MAX_SECONDS:
                raise HTTPException(422, "음성은 한 번에 10분까지 전사할 수 있어요.")
            if len(audio.readframes(frames)) != frames * 2:
                raise ValueError("truncated PCM")
            return seconds
    except HTTPException:
        raise
    except (wave.Error, EOFError, ValueError, OSError):
        raise HTTPException(422, "음성 파일을 읽을 수 없어요. 파일을 다시 선택하거나 녹음해주세요.") from None


async def get_transcription(data: bytes):
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "서버 음성 전사 설정이 필요해요. 텍스트 입력을 이용해주세요.")
    model = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
    started, failed, metrics = time.monotonic(), True, {}
    try:
        async with AsyncOpenAI(api_key=key, timeout=90, max_retries=0) as client:
            response = await client.audio.transcriptions.create(
                model=model, file=("recording.wav", data, "audio/wav"), response_format="json",
            )
        usage = getattr(response, "usage", None)
        metrics = usage.model_dump() if hasattr(usage, "model_dump") else {}
        text = response.text.strip()
        if not text:
            raise HTTPException(422, "음성을 찾지 못했어요. 더 또렷하게 녹음하거나 직접 입력해주세요.")
        failed = False
        return text
    except HTTPException:
        raise
    except APIError:
        # Never expose provider errors, filenames, transcripts or API credentials.
        raise HTTPException(502, "전사 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.") from None
    finally:
        record(model, started, failed=failed, usage=metrics, feature="audio_transcription")


async def wait_for_disconnect(request: Request, finished: asyncio.Event):
    while not finished.is_set():
        if await request.is_disconnected():
            return
        await asyncio.sleep(0.25)


@router.post("/transcriptions")
async def transcribe(request: Request, file: UploadFile = File(...), user=Depends(require_api_user)):
    if not user or not user.get("id"):
        raise HTTPException(401, "로그인 후 음성 전사를 이용해주세요.")
    try:
        if file.content_type not in {"audio/wav", "audio/x-wav", "audio/wave"}:
            raise HTTPException(415, "지원하지 않는 음성 형식이에요. 파일을 다시 선택해주세요.")
        chunks, size = [], 0
        while chunk := await file.read(64 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "전사 파일은 20MB까지 지원해요.")
            chunks.append(chunk)
        data = b"".join(chunks)
        seconds = validate_wav(data)
    finally:
        await file.close()

    operation = asyncio.create_task(get_transcription(data))
    finished = asyncio.Event()
    disconnected = asyncio.create_task(wait_for_disconnect(request, finished))
    try:
        done, _ = await asyncio.wait({operation, disconnected}, return_when=asyncio.FIRST_COMPLETED, timeout=100)
        if operation in done:
            return {"text": operation.result(), "duration_seconds": seconds}
        if disconnected in done:
            raise HTTPException(499, "전사가 취소되었어요.")
        raise HTTPException(504, "전사 시간이 초과되었어요. 더 짧은 음성으로 다시 시도해주세요.")
    finally:
        finished.set()
        operation.cancel()
        disconnected.cancel()
        await asyncio.gather(operation, disconnected, return_exceptions=True)
