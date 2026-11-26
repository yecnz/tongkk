"""Automatic source-grounded connections and resumable guided study."""
from uuid import UUID, uuid5, NAMESPACE_URL
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail
from learning_sessions.service import Service
from concept_connections import make_graph, study_plan

router = APIRouter(prefix='/learning-graph', tags=['learning-graph'])

def repository():
    return Repository()


def graph_view(value):
    graph = make_graph(value)
    plan = study_plan(graph)
    graph['study_plan'] = plan
    graph['study_target_id'] = next((step['concept_id'] for step in plan if step['is_target']), None)
    return graph


class Link(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    source_id: UUID
    target_id: UUID
    relation: Literal['equivalent', 'prerequisite']

@router.get('')
async def read(auth=Depends(session_user), repo=Depends(repository)):
    return graph_view(await repo._rpc('learning_graph_read', {'p_user': auth[0]}))

@router.post('/links')
async def link(request: Link, auth=Depends(session_user), repo=Depends(repository)):
    try:
        await repo._rpc('learning_graph_link', {'p_user': auth[0], 'p_id': str(request.id), 'p_source': str(request.source_id), 'p_target': str(request.target_id), 'p_relation': request.relation})
    except WriteConflict:
        fail('CONFLICT', '연결할 개념과 관계를 다시 확인해주세요.', 409)
    return await read(auth, repo)

@router.delete('/links/{link_id}')
async def unlink(link_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    await repo._rpc('learning_graph_unlink', {'p_user': auth[0], 'p_id': str(link_id)})
    return await read(auth, repo)


class StartPath(BaseModel):
    model_config = ConfigDict(extra='forbid')
    concept_id: UUID
    idempotency_key: UUID


class NextStep(BaseModel):
    model_config = ConfigDict(extra='forbid')
    position: int = Field(ge=0, le=11)


async def ensure_current(path, user, repo):
    if not path:
        fail('NOT_FOUND', '학습 순서를 찾을 수 없어요.', 404)
    if path['status'] != 'active':
        return path
    step = next((s for s in path['steps'] if s['position'] == path['position']), None)
    if not step or step['source_changed']:
        fail('SOURCE_CHANGED', '학습 자료가 변경되었어요. 개념 지도에서 새 학습을 시작해주세요.')
    if not step['session_id']:
        key = uuid5(NAMESPACE_URL, 'tongkk:connected:' + path['id'] + ':' + str(step['position']))
        bundle = await Service(repository=repo).create_concept(user, step['concept_id'], key)
        path = await repo._rpc('learning_graph_path_attach', {'p_user': user, 'p_path': path['id'],
                               'p_position': step['position'], 'p_session': bundle['session']['id']})
    return path


@router.post('/paths')
async def start_path(request: StartPath, auth=Depends(session_user), repo=Depends(repository)):
    existing = await repo._rpc('learning_graph_path_read', {'p_user': auth[0], 'p_path': str(request.idempotency_key)})
    if existing:
        if existing['target_id'] != str(request.concept_id):
            fail('KEY_REUSED', '다른 학습에 사용된 요청이에요.')
        return await ensure_current(existing, auth[0], repo)
    graph = make_graph(await repo._rpc('learning_graph_read', {'p_user': auth[0]}))
    steps = study_plan(graph, str(request.concept_id))
    if not steps:
        fail('NOT_FOUND', '학습할 수 있는 개념을 찾을 수 없어요. 최신 자료를 확인해주세요.', 404)
    try:
        path = await repo._rpc('learning_graph_path_begin', {'p_user': auth[0], 'p_id': str(request.idempotency_key),
                              'p_target': str(request.concept_id), 'p_steps': steps})
        return await ensure_current(path, auth[0], repo)
    except WriteConflict:
        fail('CONFLICT', '학습 순서를 새로 불러온 뒤 다시 시작해주세요.')


@router.get('/paths/{path_id}')
async def read_path(path_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    path = await repo._rpc('learning_graph_path_read', {'p_user': auth[0], 'p_path': str(path_id)})
    if not path:
        fail('NOT_FOUND', '학습 순서를 찾을 수 없어요.', 404)
    return path


@router.post('/paths/{path_id}/next')
async def next_step(path_id: UUID, request: NextStep, auth=Depends(session_user), repo=Depends(repository)):
    try:
        path = await repo._rpc('learning_graph_path_advance', {'p_user': auth[0], 'p_path': str(path_id), 'p_position': request.position})
        return await ensure_current(path, auth[0], repo)
    except WriteConflict:
        fail('NOT_COMPLETED', '현재 개념 학습을 마친 뒤 다음으로 이어갈 수 있어요.')
