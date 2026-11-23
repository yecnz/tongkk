import hashlib
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import UUID
from zoneinfo import ZoneInfo
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from config import FRONTEND_ORIGIN
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail
from workflow import durable_enabled

router = APIRouter(prefix='/integrations', tags=['integrations'])
CALLBACK_PATH = '/integrations/google-calendar/callback'
SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
TOKEN_URL = 'https://oauth2.googleapis.com/token'


def repository():
    return Repository()


def settings():
    client_id = os.getenv('GOOGLE_CALENDAR_CLIENT_ID', '')
    secret = os.getenv('GOOGLE_CALENDAR_CLIENT_SECRET', '')
    key = os.getenv('INTEGRATION_ENCRYPTION_KEY', '')
    redirect = os.getenv('GOOGLE_CALENDAR_REDIRECT_URI', FRONTEND_ORIGIN.rstrip('/') + CALLBACK_PATH)
    if not client_id or not secret or not key or redirect != FRONTEND_ORIGIN.rstrip('/') + CALLBACK_PATH:
        fail('INTEGRATION_SETUP', '캘린더 연결을 위한 서버 OAuth 설정이 필요해요.', 503)
    try:
        cipher = Fernet(key.encode())
    except ValueError:
        fail('INTEGRATION_SETUP', '캘린더 암호화 키 설정을 확인해주세요.', 503)
    return client_id, secret, cipher, redirect


def configured():
    try:
        settings()
        return True
    except Exception:
        return False


def encrypt_tokens(tokens, user, connection):
    return settings()[2].encrypt(json.dumps({'user': user, 'connection': connection, 'tokens': tokens}).encode()).decode()


def decrypt_tokens(value, user, connection):
    try:
        payload = json.loads(settings()[2].decrypt(value.encode()))
        if payload['user'] != user or payload['connection'] != connection:
            raise ValueError('Token context mismatch')
        return payload['tokens']
    except (InvalidToken, ValueError, KeyError, TypeError, AttributeError):
        raise CalendarSyncError('RECONNECT_REQUIRED') from None


def public_connection(value):
    return {key: value.get(key) for key in ('id', 'status', 'revision', 'last_synced_at', 'last_error')} if value else None


class CalendarSyncError(Exception):
    def __init__(self, code):
        self.error_code = code
        super().__init__(code)


class Callback(BaseModel):
    model_config = ConfigDict(extra='forbid')
    state: str = Field(min_length=20, max_length=200)
    code: str = Field(min_length=1, max_length=4000)


class Disconnect(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    delete_events: bool = True


class EventCourse(BaseModel):
    course_id: UUID | None = None


@router.get('')
async def listing(auth=Depends(session_user), repo=Depends(repository)):
    ready = configured()
    value = await repo._rpc('integration_connection', {'p_user': auth[0]}) if ready else None
    job = await repo._rpc('integration_job_status', {'p_user': auth[0]}) if value else None
    return {'configured': ready, 'worker_enabled': durable_enabled(), 'connection': public_connection(value), 'job': job}


@router.post('/google-calendar/connect')
async def connect(auth=Depends(session_user), repo=Depends(repository)):
    client_id, _, _, redirect = settings()
    state = secrets.token_urlsafe(40)
    await repo._rpc('integration_begin', {'p_user': auth[0], 'p_state': hashlib.sha256(state.encode()).hexdigest()})
    return {'url': 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({'client_id': client_id, 'redirect_uri': redirect,
        'response_type': 'code', 'scope': SCOPE, 'state': state, 'access_type': 'offline', 'prompt': 'consent'})}


@router.post('/google-calendar/callback')
async def callback(request: Callback, auth=Depends(session_user), repo=Depends(repository)):
    client_id, secret, _, redirect = settings()
    state_hash = hashlib.sha256(request.state.encode()).hexdigest()
    try:
        state = await repo._rpc('integration_consume', {'p_user': auth[0], 'p_state': state_hash, 'p_code': hashlib.sha256(request.code.encode()).hexdigest()})
        if state['status'] == 'done':
            return {'connection': public_connection(await repo._rpc('integration_connection', {'p_user': auth[0]}))}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(TOKEN_URL, data={'client_id': client_id, 'client_secret': secret, 'code': request.code,
                'grant_type': 'authorization_code', 'redirect_uri': redirect})
        if response.is_error:
            fail('OAUTH_FAILED', '캘린더 연결을 완료하지 못했어요. 연결을 다시 시작해주세요.', 409)
        tokens = response.json()
        if SCOPE not in tokens.get('scope', '').split() or not tokens.get('access_token') or not tokens.get('refresh_token'):
            fail('SCOPE_REQUIRED', '캘린더 읽기 권한과 지속 연결 권한을 허용한 뒤 다시 연결해주세요.', 409)
        tokens['expires_at'] = (datetime.now(timezone.utc) + timedelta(seconds=int(tokens.get('expires_in', 3600)))).isoformat()
        value = await repo._rpc('integration_connect', {'p_user': auth[0], 'p_state': state_hash,
            'p_cipher': encrypt_tokens(tokens, auth[0], state['connection_id'])})
        return {'connection': public_connection(value)}
    except WriteConflict:
        fail('OAUTH_CONFLICT', '이미 처리했거나 연결 상태가 바뀌었어요. 연결을 다시 시작해주세요.')
    except (httpx.HTTPError, ValueError, KeyError):
        fail('OAUTH_FAILED', '캘린더 연결을 완료하지 못했어요. 연결을 다시 시작해주세요.', 502)


@router.post('/google-calendar/sync')
async def queue_sync(auth=Depends(session_user), repo=Depends(repository)):
    settings()
    if not durable_enabled():
        fail('WORKER_REQUIRED', '일정 가져오기를 위한 학습 워커 설정이 필요해요.', 503)
    return {'job_id': (await repo._rpc('integration_queue', {'p_user': auth[0]}))['id']}


@router.post('/google-calendar/disconnect')
async def disconnect(request: Disconnect, auth=Depends(session_user), repo=Depends(repository)):
    value = await repo._rpc('integration_connection', {'p_user': auth[0]})
    try:
        await repo._rpc('integration_disconnect', {'p_user': auth[0], 'p_revision': request.revision, 'p_delete': request.delete_events})
    except WriteConflict:
        fail('CONFLICT', '연결 상태가 바뀌었어요. 새로 불러온 뒤 다시 시도해주세요.')
    revoked = False
    if value and value.get('tokens_ciphertext') and configured():
        try:
            tokens = decrypt_tokens(value['tokens_ciphertext'], auth[0], value['id'])
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post('https://oauth2.googleapis.com/revoke', data={'token': tokens['refresh_token']})
            revoked = response.is_success
        except (httpx.HTTPError, CalendarSyncError, KeyError):
            pass
    return {'disconnected': True, 'provider_revoked': revoked}


def normalize_event(event, zone):
    if event.get('status') == 'cancelled':
        return None
    start, end = event.get('start', {}), event.get('end', {})
    all_day = 'date' in start
    if all_day:
        start_value, end_value = start['date'], end['date']
        a = datetime.combine(date.fromisoformat(start_value), datetime.min.time(), ZoneInfo(zone))
        b = datetime.combine(date.fromisoformat(end_value), datetime.min.time(), ZoneInfo(zone))
    else:
        start_value, end_value = start['dateTime'], end['dateTime']
        a, b = datetime.fromisoformat(start_value.replace('Z', '+00:00')), datetime.fromisoformat(end_value.replace('Z', '+00:00'))
        if a.tzinfo is None:
            a = a.replace(tzinfo=ZoneInfo(start.get('timeZone', zone)))
        if b.tzinfo is None:
            b = b.replace(tzinfo=ZoneInfo(end.get('timeZone', zone)))
    if b <= a or not isinstance(event.get('id'), str) or len(event['id']) > 1024:
        raise CalendarSyncError('INVALID_EVENT')
    return {'external_id': event['id'], 'title': str(event.get('summary') or '제목 없는 일정')[:1000], 'all_day': all_day,
        'start_value': start_value, 'end_value': end_value, 'start_at': a.astimezone(timezone.utc).isoformat(), 'end_at': b.astimezone(timezone.utc).isoformat()}


async def fetch_calendar(repo, job):
    client_id, secret, _, _ = settings()
    connection = await repo._rpc('integration_connection', {'p_user': job['user_id']})
    if not connection or connection['id'] != job['connection_id'] or connection['status'] != 'connected' or connection['revision'] != job['connection_revision']:
        raise CalendarSyncError('CONNECTION_CHANGED')
    tokens = decrypt_tokens(connection['tokens_ciphertext'], job['user_id'], connection['id'])
    prefs = await repo._rpc('learning_preferences_get', {'p_user': job['user_id']})
    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=15) as client:
        if datetime.fromisoformat(tokens['expires_at']) <= now + timedelta(seconds=60):
            refreshed = await client.post(TOKEN_URL, data={'client_id': client_id, 'client_secret': secret, 'refresh_token': tokens['refresh_token'], 'grant_type': 'refresh_token'})
            if refreshed.status_code in (400, 401):
                raise CalendarSyncError('RECONNECT_REQUIRED')
            refreshed.raise_for_status()
            tokens.update(refreshed.json())
            tokens['expires_at'] = (now + timedelta(seconds=int(tokens.get('expires_in', 3600)))).isoformat()
            saved = await repo._rpc('integration_refresh', {'p_user': job['user_id'], 'p_id': connection['id'], 'p_revision': connection['revision'],
                'p_cipher': encrypt_tokens(tokens, job['user_id'], connection['id'])})
            if not saved:
                raise CalendarSyncError('CONNECTION_CHANGED')
        params = {'singleEvents': 'true', 'showDeleted': 'false', 'maxResults': '100', 'timeZone': prefs['timezone'],
                  'timeMin': (now - timedelta(days=30)).isoformat(), 'timeMax': (now + timedelta(days=180)).isoformat()}
        events = []
        for _ in range(10):
            response = await client.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', params=params, headers={'Authorization': 'Bearer ' + tokens['access_token']})
            if response.status_code in (401, 403):
                raise CalendarSyncError('RECONNECT_REQUIRED')
            response.raise_for_status()
            body = response.json()
            for event in body.get('items', []):
                value = normalize_event(event, body.get('timeZone', prefs['timezone']))
                if value:
                    events.append(value)
            if not body.get('nextPageToken'):
                return events
            params['pageToken'] = body['nextPageToken']
        raise CalendarSyncError('SYNC_LIMIT')


@router.get('/events/{day}')
async def day_events(day: str, auth=Depends(session_user), repo=Depends(repository)):
    prefs = await repo._rpc('learning_preferences_get', {'p_user': auth[0]})
    try:
        start = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=ZoneInfo(prefs['timezone']))
    except ValueError:
        fail('INVALID_DATE', '날짜를 확인해주세요.', 422)
    return {'timezone': prefs['timezone'], 'events': await repo._rpc('integration_events', {'p_user': auth[0], 'p_from': start.isoformat(), 'p_to': (start + timedelta(days=1)).isoformat()})}


@router.put('/events/{event_id}/course')
async def event_course(event_id: UUID, request: EventCourse, auth=Depends(session_user), repo=Depends(repository)):
    return {'saved': await repo._rpc('integration_event_course', {'p_user': auth[0], 'p_event': str(event_id), 'p_course': str(request.course_id) if request.course_id else None})}
