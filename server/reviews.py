from uuid import UUID
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from learning_sessions.router import session_user
from learning_sessions.repository import Repository, WriteConflict
from learning_sessions.errors import fail

router = APIRouter(prefix='/reviews', tags=['reviews'])


class SeedReview(BaseModel):
    session_id: UUID
    item_id: UUID


def get_repository():
    return Repository()


@router.get('')
async def listing(due_only: bool = True, limit: int = Query(default=30,ge=1,le=100),auth=Depends(session_user),repo=Depends(get_repository)):
    return {'cards': await repo._rpc('review_list',{'p_user':auth[0],'p_due_only':due_only,'p_limit':limit})}


@router.post('')
async def seed(request: SeedReview,auth=Depends(session_user),repo=Depends(get_repository)):
    try:
        return await repo._rpc('review_seed',{'p_user':auth[0],'p_session':str(request.session_id),'p_item':str(request.item_id)})
    except WriteConflict:
        fail('INVALID_STATE','완료한 학습의 확인된 개념을 선택해주세요.')
