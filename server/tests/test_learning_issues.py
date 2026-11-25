from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from learning_issues import router, repository, session_user
from learning_sessions.repository import WriteConflict


def test_issue_routes_validate_commands_and_scope_user():
    user, issue, key = (str(uuid4()) for _ in range(3))
    calls = []

    class Repo:
        async def _rpc(self, name, params):
            calls.append((name, params))
            if name == 'learning_issue_detail':
                return None
            if name == 'learning_issue_action':
                raise WriteConflict()
            return {'total': 0, 'issues': []}

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[session_user] = lambda: (user, 'jwt')
    app.dependency_overrides[repository] = lambda: Repo()
    client = TestClient(app)
    assert client.get('/learning-issues').json() == {'total': 0, 'issues': []}
    assert calls[-1][1]['p_user'] == user
    assert client.get('/learning-issues/' + issue).status_code == 404
    body = {'action': 'start', 'revision': 0, 'command_key': key}
    assert client.post('/learning-issues/' + issue + '/actions', json=body).status_code == 409
    assert client.post('/learning-issues/' + issue + '/actions', json={**body, 'user_id': user}).status_code == 422
    assert client.post('/learning-issues/' + issue + '/actions', json={**body, 'action': 'resolve'}).status_code == 422
    assert client.get('/learning-issues?offset=-1').status_code == 422
