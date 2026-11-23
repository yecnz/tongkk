import os
from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail

router = APIRouter(prefix='/learning-workflow', tags=['learning-workflow'])


def durable_enabled():
    return os.getenv('LEARNING_WORKER_ENABLED', 'false').lower() in {'true', '1', 'on'}


def repository():
    return Repository()


class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    auto_review: bool
    timezone: str = Field(default='Asia/Seoul', max_length=100)

    @field_validator('timezone')
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('올바른 시간대를 선택해주세요.') from None
        return value


class ReviewAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    command_key: UUID
    action: Literal['pause', 'resume', 'postpone']
    days: int = Field(default=1, ge=1, le=30)


@router.get('/preferences')
async def preferences(auth=Depends(session_user), repo=Depends(repository)):
    return await repo._rpc('learning_preferences_get', {'p_user': auth[0]})


@router.put('/preferences')
async def save_preferences(request: Preferences, auth=Depends(session_user), repo=Depends(repository)):
    return await repo._rpc('learning_preferences_set', {'p_user': auth[0], 'p_auto': request.auto_review, 'p_timezone': request.timezone})


@router.get('/reviews/{day}')
async def day_reviews(day: str, auth=Depends(session_user), repo=Depends(repository)):
    prefs = await repo._rpc('learning_preferences_get', {'p_user': auth[0]})
    try:
        start = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=ZoneInfo(prefs['timezone']))
    except ValueError:
        fail('INVALID_DATE', '날짜를 확인해주세요.', 422)
    return {'cards': await repo._rpc('workflow_reviews_range', {'p_user': auth[0], 'p_from': start.isoformat(), 'p_to': (start + timedelta(days=1)).isoformat()})}


@router.post('/reviews/{card_id}/actions')
async def review_action(card_id: UUID, request: ReviewAction, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('workflow_review_action', {'p_user': auth[0], 'p_card': str(card_id), 'p_revision': request.revision,
            'p_key': str(request.command_key), 'p_action': request.action, 'p_days': request.days})
    except WriteConflict:
        fail('CONFLICT', '복습 상태가 바뀌었어요. 새로 불러온 뒤 다시 시도해주세요.')


@router.delete('/data')
async def clear_data(auth=Depends(session_user), repo=Depends(repository)):
    from calendar_integration import disconnect, Disconnect
    connection = await repo._rpc('integration_connection', {'p_user': auth[0]})
    if connection and connection['status'] != 'disconnected':
        await disconnect(Disconnect(revision=connection['revision'], delete_events=True), auth=auth, repo=repo)
    return {'cleared': await repo._rpc('learning_workflow_clear', {'p_user': auth[0]})}
