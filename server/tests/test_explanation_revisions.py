from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from explanation_revisions import router, repository, session_user


def test_revision_submission_replay_does_not_schedule_another_evaluation():
    user, revision, session, item, key = (str(uuid4()) for _ in range(5))
    calls = []

    class Repo:
        async def _rpc(self, name, params):
            calls.append((name, params))
            if name == 'explanation_submit':
                return {'claimed': False, 'status': 'pending'}
            if name == 'explanation_read':
                return {'revision': {'id': revision, 'answer': '저장된 설명'}}
            return None

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[session_user] = lambda: (user, 'jwt')
    app.dependency_overrides[repository] = lambda: Repo()
    client = TestClient(app)
    response = client.post('/explanation-revisions/' + revision + '/submit', json={'expected_revision': 1, 'command_key': key})
    assert response.status_code == 202
    assert [name for name, _ in calls] == ['explanation_submit', 'explanation_read']
    assert all(params['p_user'] == user for _, params in calls)
    assert client.patch('/explanation-revisions/' + revision + '/draft', json={'expected_revision': -1, 'answer': 'x'}).status_code == 422
    assert client.post('/explanation-revisions', json={'id': revision, 'session_id': session, 'item_id': item, 'user_id': user}).status_code == 422
