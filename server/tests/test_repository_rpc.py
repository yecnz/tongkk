import asyncio

import httpx

from learning_sessions import repository


def test_rpc_void_returns_none(monkeypatch):
    # returns void RPC → PostgREST 204 빈 본문. JSON 파싱하다 500 나던 버그.
    monkeypatch.setattr(repository, "SUPABASE_URL", "https://db.test")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_x")
    transport = httpx.MockTransport(lambda req: httpx.Response(204))
    real = httpx.AsyncClient
    monkeypatch.setattr(repository.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    assert asyncio.run(repository.Repository()._rpc("source_begin", {})) is None
