"""Bound request bytes before JSON decoding or multipart temporary-file writes."""

from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse


class _RequestBodyTooLarge(MultiPartException):
    # MultipartParser closes its partially written files for MultiPartException.
    # Raising HTTPException here would skip that cleanup on affected versions.
    pass


class RequestBodyLimitMiddleware:
    def __init__(self, app, *, default_limit: int, path_limits: dict[str, int] | None = None):
        self.app = app
        self.default_limit = max(1, default_limit)
        self.path_limits = path_limits or {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        limit = self.path_limits.get(scope.get("path", "").rstrip("/"), self.default_limit)
        response = JSONResponse(status_code=413, content={"detail": "요청 크기가 허용 한도를 초과합니다."})
        lengths = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit() or len(lengths[0]) > 20:
                return await JSONResponse(status_code=400, content={"detail": "잘못된 요청 크기입니다."})(scope, receive, send)
            if int(lengths[0]) > limit:
                return await response(scope, receive, send)

        received = 0
        exceeded = False
        rejected = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _RequestBodyTooLarge("Request body exceeds the configured limit")
            return message

        async def limited_send(message):
            nonlocal rejected
            if exceeded:
                if not rejected:
                    rejected = True
                    await response(scope, receive, send)
                return
            await send(message)

        try:
            await self.app(scope, limited_receive, limited_send)
        except _RequestBodyTooLarge:
            # Plain ASGI consumers may not translate parser errors themselves.
            if not rejected:
                await response(scope, receive, send)
