"""HTTP contracts and recovery journeys without paid generation or a live DB.

The real PostgreSQL ownership/progress rules are exercised separately by
scripts/test-study-paths-db.mjs. Here the RPC/learning engine are fault boundaries.
"""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import study_paths as routes
from learning_sessions.repository import WriteConflict
from learning_sessions.source_scope import source_hash


@pytest.fixture
def journey(monkeypatch):
    owner, course, path, chapter, session = [str(uuid4()) for _ in range(5)]
    material = {'id': 'material', 'name': '원문', 'markdown': '프로세스는 실행 중인 프로그램이다.'}
    state = {'id': path, 'course_id': course, 'title': '시험 코스', 'revision': 0, 'chapters': [{
        'id': chapter, 'title': '프로세스', 'objective': '프로세스를 설명한다', 'included': True,
        'material_id': material['id'], 'material_name': material['name'], 'source_hash': source_hash(material['markdown']),
        'unit_ids': ['u0'], 'source_labels': ['문단 1'], 'source_changed': False, 'session_id': None,
        'session_status': None, 'completed': False,
    }]}
    flags = {'lose_save': False, 'fail_link': False, 'foreign': False}
    async def rpc(name, body):
        assert body['p_user'] == owner
        if name == 'study_path_read':
            return None if flags['foreign'] else deepcopy(state)
        if name == 'study_path_edit':
            if body['p_revision'] != state['revision']:
                raise WriteConflict()
            state['title'] = body['p_title']
            state['chapters'] = [{**next(c for c in state['chapters'] if c['id'] == edit['id']), **edit} for edit in body['p_chapters']]
            state['revision'] += 1
            if flags['lose_save']:
                flags['lose_save'] = False
                raise HTTPException(503, {'error_code': 'DB_UNAVAILABLE', 'message': '저장 응답이 유실되었습니다.'})
            return deepcopy(state)
        if name == 'study_path_link_session':
            if flags['fail_link']:
                flags['fail_link'] = False
                raise HTTPException(503, {'error_code': 'DB_UNAVAILABLE', 'message': '연결을 다시 시도해주세요.'})
            state['chapters'][0].update(session_id=session, session_status='active')
            return True
        raise AssertionError(name)
    repo = SimpleNamespace(_rpc=AsyncMock(side_effect=rpc), material=AsyncMock(return_value=material))
    engine = SimpleNamespace(create=AsyncMock(side_effect=[({'session': {'id': session}}, 'operation'), ({'session': {'id': session}}, None)]), run=AsyncMock())
    monkeypatch.setattr(routes, 'Service', lambda: engine)
    monkeypatch.setattr('workflow.durable_enabled', lambda: False)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.session_user] = lambda: (owner, 'owner-token')
    app.dependency_overrides[routes.repository] = lambda: repo
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, state=state, flags=flags, repo=repo, engine=engine, material=material,
                              path=path, chapter=chapter, session=session, owner=owner)


def edit_body(journey, title='새 코스 이름'):
    return {'revision': 0, 'title': title, 'chapters': [{'id': journey.chapter, 'title': '수정한 챕터', 'included': True}]}


def test_lost_save_response_retries_to_saved_revision_and_then_starts_learning(journey):
    j = journey
    j.flags['lose_save'] = True
    body = edit_body(j)
    lost = j.client.put(f'/study-paths/{j.path}', json=body)
    assert lost.status_code == 503
    assert j.state['revision'] == 1 and j.state['title'] == body['title']
    recovered = j.client.put(f'/study-paths/{j.path}', json=body)
    assert recovered.status_code == 200
    assert recovered.json()['revision'] == 1  # Retry is not another edit.
    started = j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={})
    assert started.status_code == 200 and started.json()['session_id'] == j.session
    j.engine.run.assert_awaited_once_with(j.owner, j.session, 'operation')
    reread = j.client.get(f'/study-paths/{j.path}').json()
    assert reread['chapters'][0]['session_id'] == j.session


def test_genuine_concurrent_edit_is_not_overwritten_by_retry(journey):
    j = journey
    assert j.client.put(f'/study-paths/{j.path}', json=edit_body(j, '다른 화면의 변경')).status_code == 200
    conflict = j.client.put(f'/study-paths/{j.path}', json=edit_body(j, '덮어쓰려는 변경'))
    assert conflict.status_code == 409
    assert j.state['title'] == '다른 화면의 변경'
    assert j.state['revision'] == 1


def test_transient_link_error_does_not_strand_preparation_and_retry_reuses_session(journey):
    j = journey
    j.flags['fail_link'] = True
    first = j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={})
    assert first.status_code == 503
    j.engine.run.assert_awaited_once_with(j.owner, j.session, 'operation')
    retry = j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={})
    assert retry.status_code == 200 and retry.json()['session_id'] == j.session
    assert j.engine.create.call_args_list[0].args[2].idempotency_key == j.engine.create.call_args_list[1].args[2].idempotency_key
    assert j.engine.run.await_count == 1
    resumed = j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={})
    assert resumed.json()['session_id'] == j.session
    assert j.engine.create.await_count == 2  # Resume bypasses generation.


def test_source_change_blocks_new_generation_and_foreign_path_is_not_readable(journey):
    j = journey
    j.material['markdown'] = '변경된 원문'
    result = j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={})
    assert result.status_code == 409 and result.json()['detail']['error_code'] == 'SOURCE_CHANGED'
    j.engine.create.assert_not_awaited()
    j.flags['foreign'] = True
    assert j.client.get(f'/study-paths/{j.path}').status_code == 404
    assert j.client.post(f'/study-paths/{j.path}/chapters/{j.chapter}/start', json={}).status_code == 404
