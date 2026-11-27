import asyncio
import json

import pytest
from fastapi import FastAPI, File, UploadFile
import starlette.formparsers

from request_limits import RequestBodyLimitMiddleware


def run_request(app, chunks, headers=(), path="/upload"):
    sent = []
    pending = iter(chunks)
    scope = {"type": "http", "method": "POST", "path": path, "raw_path": path.encode(),
             "headers": list(headers), "query_string": b"", "scheme": "http",
             "server": ("localhost", 80), "client": ("127.0.0.1", 1234), "http_version": "1.1"}

    async def receive():
        return next(pending)

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


async def echo_body(scope, receive, send):
    body = b""
    while True:
        message = await receive()
        body += message.get("body", b"")
        if not message.get("more_body", False):
            break
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": body})


def test_declared_oversize_is_rejected_before_reading_or_calling_app():
    async def forbidden(*_):
        pytest.fail("Oversized declared bodies must not reach the app")

    sent = run_request(RequestBodyLimitMiddleware(forbidden, default_limit=10), [], [(b"content-length", b"11")])
    assert sent[0]["status"] == 413


@pytest.mark.parametrize("headers", [[], [(b"content-length", b"1")]])
def test_chunked_or_underdeclared_body_is_bounded(headers):
    sent = run_request(RequestBodyLimitMiddleware(echo_body, default_limit=10), [
        {"type": "http.request", "body": b"123456", "more_body": True},
        {"type": "http.request", "body": b"78901", "more_body": False},
    ], headers)
    assert sent[0]["status"] == 413
    assert len([message for message in sent if message["type"] == "http.response.start"]) == 1


def test_body_at_limit_and_route_specific_limit():
    app = RequestBodyLimitMiddleware(echo_body, default_limit=5, path_limits={"/upload": 10})
    sent = run_request(app, [{"type": "http.request", "body": b"1234567890", "more_body": False}])
    assert sent[0]["status"] == 200
    assert sent[1]["body"] == b"1234567890"


@pytest.mark.parametrize("value", [b"-1", b"garbage", b"9" * 30])
def test_invalid_content_length_is_rejected(value):
    sent = run_request(RequestBodyLimitMiddleware(echo_body, default_limit=10), [], [(b"content-length", value)])
    assert sent[0]["status"] == 400


def test_multipart_limit_closes_partial_uploads(monkeypatch):
    files = []
    original = starlette.formparsers.SpooledTemporaryFile

    def tracked_file(*args, **kwargs):
        file = original(*args, **kwargs)
        files.append(file)
        return file

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", tracked_file)
    app = FastAPI()

    @app.post("/upload")
    async def upload(file: UploadFile = File(...)):
        pytest.fail("Oversized multipart bodies must not reach the route")

    first = (b'--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\n'
             b'Content-Type: application/pdf\r\n\r\n' + b"x" * 100)
    sent = run_request(RequestBodyLimitMiddleware(app, default_limit=500), [
        {"type": "http.request", "body": first, "more_body": True},
        {"type": "http.request", "body": b"x" * 600, "more_body": True},
    ], [(b"content-type", b"multipart/form-data; boundary=test-boundary")])
    assert sent[0]["status"] == 413
    assert json.loads(sent[1]["body"])["detail"]
    assert files and all(file.closed for file in files)
