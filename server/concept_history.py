from uuid import UUID
from fastapi import APIRouter, Depends, Query
from learning_sessions.router import session_user
from learning_sessions.repository import Repository
from learning_sessions.errors import fail
router = APIRouter(prefix='/learning-concepts', tags=['learning-concepts'])


def repository():
    return Repository()


@router.get('')
async def listing(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), auth=Depends(session_user), repo=Depends(repository)):
    return await repo._rpc('learning_concept_history_list', {'p_user': auth[0], 'p_limit': limit, 'p_offset': offset})


@router.get('/recommendations')
async def recommendations(auth=Depends(session_user), repo=Depends(repository)):
    from concept_graph import graph_view
    graph = graph_view(await repo._rpc('learning_graph_read', {'p_user':auth[0]}))
    return {'issues': await repo._rpc('learning_issue_recommendations', {'p_user': auth[0]}), 'prerequisites':graph['recommendations']}


@router.get('/{concept_id}')
async def detail(concept_id: UUID, auth=Depends(session_user), repo=Depends(repository)):
    value = await repo._rpc('learning_concept_history_detail', {'p_user': auth[0], 'p_concept': str(concept_id)})
    if not value:
        fail('NOT_FOUND', '개념 기록을 찾을 수 없어요.', 404)
    return value
