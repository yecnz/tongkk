import json
import asyncio
import time
from uuid import uuid4
from types import SimpleNamespace
import httpx
import pytest
from fastapi.testclient import TestClient
from langchain_openai import ChatOpenAI
import usage
import main


@pytest.fixture(autouse=True)
def isolated_usage(monkeypatch,tmp_path):
    monkeypatch.setenv('AI_USAGE_DB',str(tmp_path/'usage.sqlite3'))
    monkeypatch.setenv('AI_MODEL_PRICES_JSON',json.dumps({'model-test':{'input_per_million':2,'output_per_million':4}}))
    token=usage.request_usage.set({'owner':'user','feature':'summary','request_id':'request'})
    yield
    usage.request_usage.reset(token)


def test_callback_actual_client_usage_and_owner_filter():
    def respond(request):
        return httpx.Response(200,json={'id':'call','model':'model-test','choices':[{'index':0,'finish_reason':'stop','message':{'role':'assistant','content':'private answer'}}],
          'usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30}})
    client=ChatOpenAI(model='model-test',api_key='test',max_retries=0,http_client=httpx.Client(transport=httpx.MockTransport(respond)),callbacks=[usage.UsageCallback('model-test')])
    client.invoke('private prompt')
    row=usage.summary('user')[0]
    assert row['calls']==1 and row['input_tokens']==10 and row['output_tokens']==20
    assert row['estimated_usd']==pytest.approx(.0001)
    assert usage.summary('other')==[]
    with usage.connect() as db:
        data=str(db.execute('select * from ai_calls').fetchall())
    assert 'private' not in data and 'test key' not in data


def test_error_callback_is_once_and_unknown_is_not_zero():
    callback=usage.UsageCallback('unknown');run=uuid4()
    callback.on_chat_model_start({},[],run_id=run)
    callback.on_llm_error(ValueError('secret'),run_id=run)
    callback.on_llm_error(ValueError('secret'),run_id=run)
    row=usage.summary('user')[0]
    assert row['calls']==1 and row['failures']==1 and row['estimated_usd'] is None and row['input_tokens'] is None


def test_raw_generation_failure_tracks_validation_and_known_tokens():
    class Fake:
        model='model-test'
        @usage.track_generation
        async def evaluate(self):
            error=ValueError('private');error.metrics={'usage':{'prompt_tokens':4,'completion_tokens':5}};raise error
    with pytest.raises(ValueError):asyncio.run(Fake().evaluate())
    row=usage.summary('user')[0]
    assert row['feature']=='learning_grade' and row['failures']==1 and row['priced_calls']==1


def test_owner_endpoint_rejects_guest_and_aggregates_only_current_owner():
    usage.record('unknown',time.monotonic())
    main.app.dependency_overrides[main.require_api_user]=lambda:{'id':'other'}
    try:
        client=TestClient(main.app)
        assert client.get('/usage').json()['groups']==[]
        main.app.dependency_overrides[main.require_api_user]=lambda:None
        assert client.get('/usage').status_code==401
    finally:main.app.dependency_overrides.clear()


def test_storage_failure_does_not_fail_provider_result(monkeypatch):
    monkeypatch.setenv('AI_USAGE_DB','/missing/directory/file.sqlite3')
    usage.record('test',time.monotonic(),usage={'input_tokens':2,'output_tokens':3})
    assert usage.estimate('model-test',None,3) is None
