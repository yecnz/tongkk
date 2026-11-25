import asyncio
from copy import deepcopy
from datetime import datetime,timezone
from types import SimpleNamespace
import pytest
from learning_sessions.generation import Generator,GenerationError
from reviews import review_concept,review_view


def concept(question='원래 질문'):
    refs=[{'unit_id':'u0','quote':'프로세스는 실행 중인 프로그램이다.'}]
    return {'title':'프로세스','question':question,'introduction':'실행 중인 프로그램','source_refs':refs,'criteria':[{'id':'c1','description':'실행 상태','source_refs':refs}],
            'hints':['실행을 생각해보세요.','프로그램 상태를 떠올리세요.'],'reference':'프로세스는 실행 중인 프로그램이다.',
            'check':{'question':'무엇이 실행 중인가요?','options':['프로그램','파일'],'answer_index':0,'explanation':'프로세스는 실행 중인 프로그램이다.'}}


def test_novel_generation_rejects_a_repeated_question_and_checks_original_quotes(monkeypatch):
    async def run():
        generator=Generator();original=concept();pack={'source_units':[{'id':'u0','text':'프로세스는 실행 중인 프로그램이다.'}]}
        async def call(*args):return concept(),{}
        monkeypatch.setattr(generator,'_call',call)
        with pytest.raises(GenerationError):await generator.review_question(pack,original,[])
        async def fresh(*args):return concept('실행을 시작한 프로그램을 무엇이라고 부르나요?'),{}
        monkeypatch.setattr(generator,'_call',fresh)
        value,_=await generator.review_question(pack,original,[])
        assert value['question']!=original['question']
        value['source_refs'][0]['quote']='원문에 없는 내용'
        async def invalid(*args):return value,{}
        monkeypatch.setattr(generator,'_call',invalid)
        with pytest.raises(GenerationError):await generator.review_question(pack,original,[])
        value['source_refs'][0]['quote']='   '
        with pytest.raises(GenerationError):await generator.review_question(pack,original,[])
    asyncio.run(run())


def test_review_projection_keeps_answer_keys_private_and_uses_saved_question():
    original,new=concept(),concept('새로운 질문')
    entry={'id':'a','question_id':'q','answer':'설명','assisted':False,'status':'pending','lease_expires_at':'2099-01-01T00:00:00+00:00'}
    ctx={'card':{'id':'c','due_at':datetime.now(timezone.utc).isoformat()},'concept':original,'questions':[{'id':'q','content':new}],
         'next_question':{'id':'q','content':new,'status':'ready'},'attempts':[entry],'source_changed':False,'baseline':{}}
    assert review_concept(ctx,entry)['question']=='새로운 질문'
    value=review_view(ctx)
    assert value['question']=='새로운 질문' and value['question_id']=='q'
    assert value['check'] is None and 'answer_index' not in str(value) and 'criteria' not in str(value)
