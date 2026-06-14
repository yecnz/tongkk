"""인증 의존성 — Supabase JWT 검증.

main.py에서 분리(Stage 6a). require_api_user를 FastAPI Depends로 라우터에서 사용한다.
설정 누락/플레이스홀더는 503(fail-closed), 토큰 문제는 401로 막는다.
"""
import httpx
from fastapi import Header, HTTPException

from config import (
    ALLOW_NO_AUTH,
    SUPABASE_ANON_KEY,
    SUPABASE_PLACEHOLDER_VALUES,
    SUPABASE_URL,
)


async def require_api_user(authorization: str | None = Header(default=None)):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        if ALLOW_NO_AUTH:
            return None
        raise HTTPException(
            status_code=503,
            detail="서버 인증 설정(SUPABASE_URL/SUPABASE_ANON_KEY)이 누락되었습니다.",
        )
    if SUPABASE_URL in SUPABASE_PLACEHOLDER_VALUES:
        raise HTTPException(status_code=503, detail="백엔드 Supabase URL이 실제 프로젝트 주소로 설정되지 않았습니다.")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="로그인이 필요한 API입니다.")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="인증 토큰이 비어 있습니다.")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"인증 서버 확인 실패: {str(e)}") from e

    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="유효하지 않은 로그인입니다.")

    return response.json()
