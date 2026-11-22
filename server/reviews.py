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


from datetime import datetime, timezone
from fastapi import BackgroundTasks
from pydantic import Field, StrictInt, field_validator
from learning_sessions.generation import Generator
from review_schedule import next_review


class SubmitReview(BaseModel):
    attempt_id: UUID
    answer: str = Field(min_length=1,max_length=4000)
    assisted: bool = False

    @field_validator('answer')
    @classmethod
    def nonempty(cls,value):
        if not value.strip():
            raise ValueError('설명을 입력해주세요.')
        return value


class CheckReview(BaseModel):
    attempt_id: UUID
    selected: StrictInt = Field(ge=0,le=4)


async def context(repo,user,card):
    value=await repo._rpc('review_context',{'p_user':user,'p_card':card})
    if not value:
        fail('NOT_FOUND','복습 기록을 찾을 수 없어요.',404)
    return value


def review_view(ctx):
    card,concept=ctx['card'],ctx['concept']
    attempts=[]
    for a in ctx['attempts']:
        expired=a['status']=='pending' and datetime.fromisoformat(a['lease_expires_at'])<=datetime.now(timezone.utc)
        attempts.append({'id':a['id'],'answer':a['answer'],'assisted':a['assisted'],
                         'status':'ungraded' if expired else a['status'],'feedback':a.get('feedback'),
                         'check_result':a.get('check_result'),'eligible_for_schedule':a.get('eligible_for_schedule',False),
                         'error_code':'EXPIRED' if expired else a.get('error_code')})
    latest=attempts[0] if attempts else None
    show_check=latest and latest['status']=='graded'
    return {'id':card['id'],'title':concept['title'],'question':concept['question'],'due_at':card['due_at'],
            'source_changed':ctx['source_changed'],'latest':latest,
            'check':{'question':concept['check']['question'],'options':concept['check']['options']} if show_check else None,
            'baseline':{'answer':ctx['baseline'].get('draft'),'feedback':ctx['baseline'].get('feedback')} if show_check else None,
            'previous':attempts[1] if len(attempts)>1 and show_check else None}


async def run_review(repo,user,card,attempt):
    ctx=await context(repo,user,card)
    entry=next((a for a in ctx['attempts'] if a['id']==attempt),None)
    if not entry or entry['status']!='pending':
        return
    output,metrics,error=None,{},None
    try:
        output,metrics=await Generator().evaluate(ctx['pack'],ctx['concept'],entry['answer'])
    except Exception as exc:
        metrics=getattr(exc,'metrics',{})
        error='MODEL_FAILED'
    await repo._rpc('review_finish',{'p_user':user,'p_card':card,'p_id':attempt,'p_feedback':output,
                                    'p_metrics':metrics,'p_error':error,'p_interval':None,'p_success':False})


@router.get('/{card_id}')
async def read(card_id: UUID,auth=Depends(session_user),repo=Depends(get_repository)):
    return review_view(await context(repo,auth[0],str(card_id)))


@router.post('/{card_id}/answers',status_code=202)
async def submit(card_id: UUID,request: SubmitReview,tasks: BackgroundTasks,auth=Depends(session_user),repo=Depends(get_repository)):
    try:
        entry=await repo._rpc('review_start',{'p_user':auth[0],'p_card':str(card_id),'p_id':str(request.attempt_id),
                                            'p_answer':request.answer,'p_assisted':request.assisted})
    except WriteConflict:
        fail('CONFLICT','이전 복습 요청을 확인해주세요.')
    if entry.get('claimed') and entry['status']=='pending':
        tasks.add_task(run_review,repo,auth[0],str(card_id),str(request.attempt_id))
    return review_view(await context(repo,auth[0],str(card_id)))


@router.post('/{card_id}/check')
async def check(card_id: UUID,request: CheckReview,auth=Depends(session_user),repo=Depends(get_repository)):
    ctx=await context(repo,auth[0],str(card_id))
    attempt=next((a for a in ctx['attempts'] if a['id']==str(request.attempt_id)),None)
    if not attempt or attempt['status']!='graded':
        fail('INVALID_STATE','설명 평가 후 확인 문제를 풀어주세요.')
    correct=request.selected==ctx['concept']['check']['answer_index']
    interval,success=next_review(attempt['feedback'],attempt['assisted'] or not correct,ctx['card']['successful_reviews'])
    try:
        await repo._rpc('review_check',{'p_user':auth[0],'p_card':str(card_id),'p_id':str(request.attempt_id),
                                      'p_selected':request.selected,'p_interval':interval,'p_success':success})
    except WriteConflict:
        fail('CONFLICT','이미 제출한 답안이나 학습 상태를 확인해주세요.')
    return review_view(await context(repo,auth[0],str(card_id)))
