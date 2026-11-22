"""가입/복구 오류는 로그인 비밀번호 실패 횟수에 포함하지 않는다."""
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

import login_attempts
import login_security
import main


@pytest.fixture
def login_client(tmp_path, monkeypatch):
    monkeypatch.setattr(login_attempts, 'DB_PATH', tmp_path / 'auth.sqlite3')
    login_attempts._init()
    monkeypatch.setattr(main, 'SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setattr(main, 'SUPABASE_ANON_KEY', 'anon-test')
    monkeypatch.setattr(login_security, 'SUPABASE_ANON_KEY', 'anon-test')
    monkeypatch.setattr(login_security, 'LOGIN_FORWARD_CLIENT_IP', False)
    upstream = AsyncMock()
    connection = AsyncMock()
    connection.__aenter__.return_value.post = upstream
    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda **_: connection)
    with TestClient(main.app) as client:
        yield client, upstream


def login(client):
    return client.post('/auth/login', json={'email': 'student@example.test', 'password': 'correct-password'})


def failures():
    return login_attempts.retry_after_seconds(login_attempts.account_key('student@example.test'))


def test_unconfirmed_email_is_actionable_and_never_locks(login_client):
    client, upstream = login_client
    upstream.return_value = httpx.Response(400, json={'code': 'email_not_confirmed'})
    for _ in range(7):
        response = login(client)
        assert response.status_code == 403
        assert response.json()['error_code'] == 'email_not_confirmed'
    assert failures() == 0
    # 이후 실제 비밀번호 실패를 처음부터 센다.
    upstream.return_value = httpx.Response(400, json={'code': 'invalid_credentials'})
    assert [login(client).status_code for _ in range(5)] == [401, 401, 401, 401, 429]


@pytest.mark.parametrize('status, body', [
    (400, {'code': 'unexpected_failure', 'msg': 'internal information'}),
    (401, {}),
    (422, {'code': 'validation_failed'}),
    (400, []),
])
def test_noncredential_failures_do_not_lock(login_client, status, body):
    client, upstream = login_client
    upstream.return_value = httpx.Response(status, json=body)
    for _ in range(6):
        response = login(client)
        assert response.status_code == 400
        assert 'internal information' not in response.text
    assert failures() == 0


def test_success_clears_failures_and_tokens_are_not_cached(login_client):
    client, upstream = login_client
    upstream.return_value = httpx.Response(400, json={'code': 'invalid_credentials'})
    assert login(client).status_code == 401
    upstream.return_value = httpx.Response(200, json={'access_token': 'user-access', 'refresh_token': 'user-refresh'})
    response = login(client)
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.json() == {'access_token': 'user-access', 'refresh_token': 'user-refresh'}
    upstream.return_value = httpx.Response(400, json={'code': 'invalid_credentials'})
    assert [login(client).status_code for _ in range(5)] == [401, 401, 401, 401, 429]


def test_provider_rate_limit_does_not_increment_password_failures(login_client):
    client, upstream = login_client
    upstream.return_value = httpx.Response(429, json={'code': 'over_request_rate_limit'})
    for _ in range(6):
        response = login(client)
        assert response.status_code == 429
        assert response.headers['Retry-After'] == '60'
    assert failures() == 0


def test_network_failure_is_retryable_without_lock(login_client):
    client, upstream = login_client
    upstream.side_effect = httpx.ConnectError('unavailable')
    assert login(client).status_code == 503
    assert failures() == 0


def request_with_spoofed_header(client_ip='203.0.113.9'):
    return Request({'type': 'http', 'client': (client_ip, 1234),
                    'headers': [(b'x-forwarded-for', b'198.51.100.55'), (b'cf-connecting-ip', b'198.51.100.66')]})


def test_ip_forwarding_is_opt_in_and_does_not_leak_secret(monkeypatch):
    monkeypatch.setattr(login_security, 'LOGIN_FORWARD_CLIENT_IP', False)
    monkeypatch.setattr(login_security, 'SUPABASE_ANON_KEY', 'anon-test')
    monkeypatch.setattr(login_security, 'SUPABASE_SECRET_KEY', 'server-secret')
    assert login_security.upstream_headers(request_with_spoofed_header()) == {
        'apikey': 'anon-test', 'Content-Type': 'application/json'}


def test_ip_forwarding_uses_only_trusted_asgi_client(monkeypatch):
    monkeypatch.setattr(login_security, 'LOGIN_FORWARD_CLIENT_IP', True)
    monkeypatch.setattr(login_security, 'SUPABASE_SECRET_KEY', 'server-secret')
    headers = login_security.upstream_headers(request_with_spoofed_header())
    assert headers['Sb-Forwarded-For'] == '203.0.113.9'
    assert headers['apikey'] == 'server-secret'


@pytest.mark.parametrize('secret, client_ip', [('', '203.0.113.9'), ('server-secret', 'not-an-ip')])
def test_forwarding_fails_closed_on_missing_config(monkeypatch, secret, client_ip):
    monkeypatch.setattr(login_security, 'LOGIN_FORWARD_CLIENT_IP', True)
    monkeypatch.setattr(login_security, 'SUPABASE_SECRET_KEY', secret)
    with pytest.raises(HTTPException) as exc:
        login_security.upstream_headers(request_with_spoofed_header(client_ip))
    assert exc.value.status_code == 503
