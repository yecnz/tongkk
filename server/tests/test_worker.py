import asyncio
from types import SimpleNamespace
from worker import run_one


def test_worker_saves_review_result_with_its_lease():
    calls = []

    class Repo:
        async def _rpc(self, name, params):
            calls.append((name, params))
            if name == 'workflow_claim':
                return {'id': 'job', 'user_id': 'user', 'kind': 'review', 'target_id': 'attempt', 'review_card_id': 'card', 'lease_token': 'lease'}
            if name == 'review_context':
                return {'attempts': [{'id': 'attempt', 'answer': 'my answer'}], 'source_changed': False, 'pack': {}, 'concept': {}}
            return True

    async def evaluate(*args):
        return {'criteria': []}, {'usage': None}

    assert asyncio.run(run_one(Repo(), SimpleNamespace(evaluate=evaluate)))
    finish = calls[-1][1]
    assert finish['p_token'] == 'lease' and finish['p_job'] == 'job'
    assert finish['p_error'] is None
    assert 'my answer' not in str(finish)


def test_worker_does_not_call_model_for_changed_source():
    class Repo:
        async def _rpc(self, name, params):
            if name == 'workflow_claim':
                return {'id': 'j', 'user_id': 'u', 'kind': 'review', 'target_id': 'a', 'review_card_id': 'c', 'lease_token': 'l'}
            if name == 'review_context':
                return {'attempts': [{'id': 'a'}], 'source_changed': True}
            assert params['p_error'] == 'SOURCE_CHANGED'
            return True

    assert asyncio.run(run_one(Repo(), object()))
