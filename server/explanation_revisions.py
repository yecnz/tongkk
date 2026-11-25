from uuid import UUID
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel, ConfigDict, Field
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.generation import Generator
from learning_sessions.service import concept_for
from learning_sessions.errors import fail

router = APIRouter(prefix='/explanation-revisions', tags=['explanation-revisions'])


def repository():
    return Repository()


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Create(Input):
    id: UUID
    session_id: UUID
    item_id: UUID
    parent_id: UUID | None = None


class Draft(Input):
    expected_revision: int = Field(ge=0)
    answer: str = Field(max_length=4000)
    assisted: bool = True


class Submit(Input):
    expected_revision: int = Field(ge=0)
    command_key: UUID


async def read_value(repo, user, revision):
    value = await repo._rpc('explanation_read', {'p_user': user, 'p_id': revision})
    if not value:
        fail('NOT_FOUND', '설명 수정 기록을 찾을 수 없어요.', 404)
    return value


async def evaluate(repo, user, revision, key):
    value = await read_value(repo, user, revision)
    if not value.get('evaluation') or value['evaluation']['id'] != key or value['evaluation']['status'] != 'pending':
        return
    r = value['revision']
    bundle = await repo.load(user, r['session_id'])
    item = next(i for i in bundle['items'] if i['id'] == r['item_id'])
    result, metrics, error = None, {}, None
    try:
        result, metrics = await Generator().evaluate(bundle['pack'], concept_for(bundle, item), r['answer'])
    except Exception as exc:
        metrics = getattr(exc, 'metrics', {})
        error = 'MODEL_FAILED'
    await repo._rpc('explanation_finish', {'p_user': user, 'p_id': revision, 'p_key': key,
        'p_feedback': result, 'p_metrics': metrics, 'p_error': error})


@router.post('')
async def create(request: Create, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('explanation_create', {'p_user': auth[0], 'p_id': str(request.id),
            'p_session': str(request.session_id), 'p_item': str(request.item_id),
            'p_parent': str(request.parent_id) if request.parent_id else None})
    except WriteConflict:
        fail('CONFLICT', '완료 학습의 제출한 설명을 선택해주세요.')


@router.get('/{revision_id}')
async def read(revision_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    return await read_value(repo, auth[0], str(revision_id))


@router.patch('/{revision_id}/draft')
async def draft(revision_id: UUID, request: Draft, auth=Depends(session_user), repo=Depends(repository)):
    try:
        return await repo._rpc('explanation_save', {'p_user': auth[0], 'p_id': str(revision_id),
            'p_expected': request.expected_revision, 'p_answer': request.answer, 'p_assisted': request.assisted})
    except WriteConflict:
        fail('CONFLICT', '다른 화면에서 바뀌었거나 이미 제출했어요. 기록을 다시 확인해주세요.')


@router.post('/{revision_id}/submit', status_code=202)
async def submit(revision_id: UUID, request: Submit, tasks: BackgroundTasks, auth=Depends(session_user), repo=Depends(repository)):
    try:
        value = await repo._rpc('explanation_submit', {'p_user': auth[0], 'p_id': str(revision_id),
            'p_expected': request.expected_revision, 'p_key': str(request.command_key)})
    except WriteConflict:
        fail('CONFLICT', '설명과 평가 상태를 다시 확인해주세요.')
    if value.get('claimed'):
        from workflow import durable_enabled
        if not durable_enabled():
            tasks.add_task(evaluate, repo, auth[0], str(revision_id), str(request.command_key))
    return await read_value(repo, auth[0], str(revision_id))
