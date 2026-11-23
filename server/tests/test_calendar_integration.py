import asyncio
from datetime import datetime, timedelta, timezone
from cryptography.fernet import Fernet
import httpx
import pytest
import calendar_integration as calendar


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('GOOGLE_CALENDAR_CLIENT_ID', 'client-id')
    monkeypatch.setenv('GOOGLE_CALENDAR_CLIENT_SECRET', 'client-secret')
    monkeypatch.setenv('INTEGRATION_ENCRYPTION_KEY', Fernet.generate_key().decode())
    monkeypatch.delenv('GOOGLE_CALENDAR_REDIRECT_URI', raising=False)


def test_credentials_are_encrypted_and_bound_to_owner_and_connection(configured):
    value = calendar.encrypt_tokens({'refresh_token': 'private-token'}, 'owner', 'connection')
    assert 'private-token' not in value
    assert calendar.decrypt_tokens(value, 'owner', 'connection')['refresh_token'] == 'private-token'
    with pytest.raises(calendar.CalendarSyncError):
        calendar.decrypt_tokens(value, 'another-owner', 'connection')
    assert 'tokens_ciphertext' not in calendar.public_connection({'id': 'c', 'tokens_ciphertext': value})


def test_all_day_end_is_exclusive_and_event_time_is_preserved():
    value = calendar.normalize_event({'id': 'recurring-instance', 'summary': '시험', 'start': {'date': '2026-11-23'}, 'end': {'date': '2026-11-24'}}, 'Asia/Seoul')
    assert value['all_day'] is True
    assert value['start_at'] == '2026-11-22T15:00:00+00:00'
    assert value['end_value'] == '2026-11-24'
    assert calendar.normalize_event({'id': 'deleted', 'status': 'cancelled'}, 'UTC') is None
    with pytest.raises(calendar.CalendarSyncError):
        calendar.normalize_event({'id': 'bad', 'start': {'date': '2026-11-24'}, 'end': {'date': '2026-11-23'}}, 'UTC')


def test_sync_refreshes_expired_tokens_and_reads_every_page(configured, monkeypatch):
    tokens = {'access_token': 'old', 'refresh_token': 'private-refresh', 'expires_at': (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}
    value = calendar.encrypt_tokens(tokens, 'u', 'c')
    updated = []

    class Repo:
        async def _rpc(self, name, params):
            if name == 'integration_connection':
                return {'id': 'c', 'status': 'connected', 'revision': 2, 'tokens_ciphertext': value}
            if name == 'learning_preferences_get':
                return {'timezone': 'Asia/Seoul'}
            updated.append(params['p_cipher'])
            return True

    calls = []
    def respond(request):
        calls.append(request)
        if str(request.url) == calendar.TOKEN_URL:
            return httpx.Response(200, json={'access_token': 'new', 'expires_in': 3600})
        assert request.headers['authorization'] == 'Bearer new'
        suffix = 'second' if request.url.params.get('pageToken') else 'first'
        return httpx.Response(200, json={'timeZone': 'Asia/Seoul', 'items': [{'id': suffix, 'start': {'date': '2026-11-23'}, 'end': {'date': '2026-11-24'}}], **({'nextPageToken': 'next'} if suffix == 'first' else {})})

    client = httpx.AsyncClient
    monkeypatch.setattr(calendar.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    result = asyncio.run(calendar.fetch_calendar(Repo(), {'user_id': 'u', 'connection_id': 'c', 'connection_revision': 2}))
    assert [e['external_id'] for e in result] == ['first', 'second']
    assert len(calls) == 3
    assert calendar.decrypt_tokens(updated[0], 'u', 'c')['access_token'] == 'new'
