import copy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reviews

USER,CARD,OTHER=str(uuid4()),str(uuid4()),str(uuid4())


class ReviewRepository:
    def __init__(self):
        self.value={'card':{'id':CARD,'due_at':datetime.now(timezone.utc).isoformat(),'successful_reviews':0},
          'concept':{'title':'분산 학습','question':'분산 학습을 설명하세요.','criteria':[{'id':'c1','description':'비공개 기준'}],
                     'check':{'question':'방법 선택','options':['시간을 두고 반복','한 번에 전부'],'answer_index':0,'explanation':'시간 간격이 근거예요.'}},
          'pack':{'source_units':[{'id':'u0','text':'원문'}]},'baseline':{'draft':'처음 설명'},'source_changed':False,'attempts':[]}

    async def _rpc(self,name,p):
        if p['p_user']!=USER: return None
        if name=='review_context': return copy.deepcopy(self.value)
        if name=='review_start':
            previous=next((a for a in self.value['attempts'] if a['id']==p['p_id']),None)
            if previous: return dict(previous,claimed=False)
            entry={'id':p['p_id'],'answer':p['p_answer'],'assisted':p['p_assisted'],'status':'pending','feedback':None,
                   'lease_expires_at':(datetime.now(timezone.utc)+timedelta(seconds=90)).isoformat(),'eligible_for_schedule':True}
            self.value['attempts'].insert(0,entry)
            return dict(entry,claimed=True)
        if name=='review_finish':
            entry=self.value['attempts'][0];entry.update(status='ungraded' if p['p_error'] else 'graded',feedback=p['p_feedback'])
            assert p['p_interval'] is None
            return copy.deepcopy(entry)
        if name=='review_check':
            self.value['attempts'][0]['check_result']={'selected':p['p_selected'],'answer_index':0,'correct':p['p_selected']==0,'explanation':'근거'}
            self.value['card']['due_at']=(datetime.now(timezone.utc)+timedelta(days=p['p_interval'] or 1)).isoformat()
            return copy.deepcopy(self.value['attempts'][0])
        raise AssertionError(name)


@pytest.fixture
def flow(monkeypatch):
    repo=ReviewRepository(); calls=[]
    async def evaluate(*args):
        calls.append(args)
        return {'criteria':[{'criterion_id':'c1','status':'met','student_quote':'답변','reason':'시간 간격을 설명했어요.',
                             'source_refs':[{'unit_id':'u0','quote':'원문'}]}]}, {'model_id':'test'}
    monkeypatch.setattr(reviews,'Generator',lambda:SimpleNamespace(evaluate=evaluate))
    app=FastAPI();app.include_router(reviews.router)
    app.dependency_overrides[reviews.session_user]=lambda:(USER,'jwt')
    app.dependency_overrides[reviews.get_repository]=lambda:repo
    return TestClient(app),repo,calls,app


def test_review_recall_then_check_and_duplicate_submission(flow):
    client,repo,calls,_=flow
    before=client.get('/reviews/'+CARD).json()
    assert before['check'] is None and before['baseline'] is None
    assert 'source_units' not in before and 'criteria' not in before
    payload={'attempt_id':str(uuid4()),'answer':'답변','assisted':False}
    assert client.post('/reviews/'+CARD+'/answers',json=payload).status_code==202
    graded=client.get('/reviews/'+CARD).json()
    assert graded['latest']['status']=='graded' and graded['check']
    assert 'answer_index' not in graded['check']
    client.post('/reviews/'+CARD+'/answers',json=payload)
    assert len(calls)==1
    checked=client.post('/reviews/'+CARD+'/check',json={'attempt_id':payload['attempt_id'],'selected':0})
    assert checked.status_code==200 and checked.json()['latest']['check_result']['correct']
    assert checked.json()['baseline']['answer']=='처음 설명'


def test_review_errors_do_not_turn_into_failed_learning_or_reschedule(flow,monkeypatch):
    client,repo,_,_=flow;due=repo.value['card']['due_at']
    async def fail(*args): raise ValueError('private provider response')
    monkeypatch.setattr(reviews,'Generator',lambda:SimpleNamespace(evaluate=fail))
    response=client.post('/reviews/'+CARD+'/answers',json={'attempt_id':str(uuid4()),'answer':'답변'})
    assert response.status_code==202
    result=client.get('/reviews/'+CARD).json()
    assert result['latest']['status']=='ungraded' and result['due_at']==due
    assert 'private provider response' not in str(result)


def test_review_owner_and_invalid_answers(flow):
    client,_,_,app=flow
    assert client.post('/reviews/'+CARD+'/answers',json={'attempt_id':str(uuid4()),'answer':'   '}).status_code==422
    app.dependency_overrides[reviews.session_user]=lambda:(OTHER,'jwt')
    assert client.get('/reviews/'+CARD).status_code==404
