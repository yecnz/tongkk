from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail

router = APIRouter(prefix='/learning-issues', tags=['learning-issues'])


def repository():
    return Repository()


class IssueAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    command_key: UUID
    action: Literal['start', 'reassess', 'close', 'reopen']


@router.get('')
async def listing(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                  auth=Depends(session_user), repo=Depends(repository)):
    return await repo._rpc('learning_issue_list', {'p_user': auth[0], 'p_limit': limit, 'p_offset': offset})


class QuizLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID
    question_index: int = Field(ge=0)
    concept_id: UUID


@router.get('/quiz/{attempt_id}/concepts')
async def quiz_concepts(attempt_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    return {'concepts': await repo._rpc('learning_quiz_concepts', {'p_user': auth[0], 'p_attempt': str(attempt_id)})}


@router.post('/from-quiz')
async def from_quiz(request: QuizLink, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('learning_issue_from_quiz', {'p_user': auth[0], 'p_attempt': str(request.attempt_id),
            'p_index': request.question_index, 'p_concept': str(request.concept_id)})
    except WriteConflict:
        fail('CONFLICT', '오답 문항과 연결할 개념을 확인해주세요.')


@router.get('/{issue_id}')
async def detail(issue_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    value = await repo._rpc('learning_issue_detail', {'p_user': auth[0], 'p_issue': str(issue_id)})
    if not value:
        fail('NOT_FOUND', '학습 이슈를 찾을 수 없어요.', 404)
    return value


@router.post('/{issue_id}/actions')
async def action(issue_id: UUID, request: IssueAction, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('learning_issue_action', {'p_user': auth[0], 'p_issue': str(issue_id),
            'p_revision': request.revision, 'p_key': str(request.command_key), 'p_action': request.action})
    except WriteConflict:
        fail('CONFLICT', '이슈가 바뀌었어요. 새로 불러온 뒤 다시 시도해주세요.')
