"""Supabase 로그인에 전달할 헤더. 브라우저의 전달 헤더를 직접 신뢰하지 않는다."""
from ipaddress import ip_address

from fastapi import HTTPException, Request

from config import LOGIN_FORWARD_CLIENT_IP, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY


def upstream_headers(request: Request) -> dict[str, str]:
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    if not LOGIN_FORWARD_CLIENT_IP:
        return headers
    if not SUPABASE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="로그인 IP 전달에 필요한 서버 키 설정이 누락되었습니다.")
    try:
        # Uvicorn --forwarded-allow-ips로 지정한 프록시만 request.client를 바꿀 수 있다.
        # X-Forwarded-For / CF-Connecting-IP를 여기서 직접 읽으면 위조할 수 있다.
        client_ip = str(ip_address(request.client.host if request.client else ""))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="로그인 요청의 클라이언트 IP를 확인할 수 없습니다.") from exc
    headers.update({"apikey": SUPABASE_SECRET_KEY, "Sb-Forwarded-For": client_ip})
    return headers
