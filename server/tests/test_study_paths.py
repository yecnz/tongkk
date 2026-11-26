from uuid import UUID, uuid4, uuid5
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException

from learning_sessions.source_scope import units
from study_paths import CreatePath, EditPath, create, start, validate_chapters


def material(mid='lecture'):
    return {'id': mid, 'name': '강의자료', 'markdown': '<!-- p.1 -->\n기초 개념\n<!-- p.2 -->\n응용 개념'}


def draft(materials):
    return {'chapters': [{'material_id': m['id'], 'title': '기초와 응용', 'objective': '기초에서 응용으로 설명한다.',
                         'unit_ids': [u['id'] for u in reversed(units(m['markdown']))]} for m in materials]}


def test_chapters_use_canonical_source_order_and_preserve_all_materials():
    sources = [material('one'), material('two')]
    chapters = validate_chapters(draft(sources), sources)
    assert len(chapters) == 2
    assert chapters[0]['unit_ids'] == [u['id'] for u in units(sources[0]['markdown'])]
    assert chapters[0]['source_labels'] == ['1페이지/슬라이드', '2페이지/슬라이드']
    assert len(chapters[0]['source_hash']) == 64
    assert chapters[0]['id'] != chapters[1]['id']


@pytest.mark.parametrize('kind', ['foreign_material', 'foreign_unit', 'duplicate_scope', 'missing_material'])
def test_rejects_unsupported_or_incomplete_drafts(kind):
    sources = [material('one'), material('two')]
    raw = draft(sources)
    if kind == 'foreign_material':
        raw['chapters'][0]['material_id'] = 'other-owner-material'
    elif kind == 'foreign_unit':
        raw['chapters'][0]['unit_ids'] = ['u99999']
    elif kind == 'duplicate_scope':
        raw['chapters'].append(raw['chapters'][0])
    else:
        raw['chapters'].pop()
    with pytest.raises((ValueError, HTTPException)):
        validate_chapters(raw, sources)


def test_chapter_scope_must_fit_existing_learning_session_limit():
    source = {'id': 'large', 'name': '큰 자료', 'markdown': 'x' * 12001}
    with pytest.raises(HTTPException) as exc:
        validate_chapters(draft([source]), [source])
    assert exc.value.status_code == 422


def test_edits_cannot_set_progress_or_change_source_fields():
    raw = {'revision': 0, 'title': '수정', 'chapters': [{'id': str(uuid4()), 'title': '단원', 'included': True, 'completed': True}]}
    with pytest.raises(ValueError):
        EditPath.model_validate(raw)


@pytest.mark.anyio
async def test_existing_id_is_recovered_without_generating_again():
    user, course, path = map(str, [uuid4(), uuid4(), uuid4()])
    repo = AsyncMock()
    repo._rpc.return_value = {'id': path, 'chapters': []}
    with patch('study_paths.PathGenerator.draft', new_callable=AsyncMock) as generate:
        result = await create(CreatePath(id=path, course_id=course, material_ids=['one'], title='코스'), (user, 'token'), repo)
    assert result['id'] == path
    generate.assert_not_awaited()
    repo.material.assert_not_awaited()


@pytest.mark.anyio
async def test_create_reads_material_with_authenticated_owner_and_token():
    user, course, path = map(str, [uuid4(), uuid4(), uuid4()])
    repo = AsyncMock()
    repo._rpc.side_effect = [None, {'id': path}]
    repo.material.return_value = material('one')
    with patch('study_paths.PathGenerator.draft', new_callable=AsyncMock, return_value=(draft([material('one')]), {})):
        result = await create(CreatePath(id=path, course_id=course, material_ids=['one'], title='코스'), (user, 'user-token'), repo)
    assert result['id'] == path
    repo.material.assert_awaited_once_with(user, 'user-token', course, 'one')
    assert repo._rpc.call_args.args[1]['p_user'] == user


@pytest.mark.anyio
async def test_deleted_or_excluded_chapter_cannot_start():
    repo = AsyncMock()
    repo._rpc.return_value = {'chapters': []}
    with pytest.raises(HTTPException) as exc:
        await start(uuid4(), uuid4(), BackgroundTasks(), (str(uuid4()), 'token'), repo)
    assert exc.value.status_code == 404
    repo.material.assert_not_awaited()


@pytest.mark.anyio
async def test_resume_returns_same_session_without_charging_generation():
    chapter, path, session = map(str, [uuid4(), uuid4(), uuid4()])
    repo = AsyncMock()
    repo._rpc.return_value = {'chapters': [{'id': chapter, 'included': True, 'session_id': session, 'session_status': 'active'}]}
    result = await start(UUID(path), UUID(chapter), BackgroundTasks(), (str(uuid4()), 'token'), repo)
    assert result == {'session_id': session}
    repo.material.assert_not_awaited()


@pytest.mark.anyio
async def test_start_creates_existing_learning_flow_with_source_scope_and_links_it():
    user, course, path, session = map(str, [uuid4(), uuid4(), uuid4(), uuid4()])
    chapter = validate_chapters(draft([material()]), [material()])[0]
    repo = AsyncMock()
    repo._rpc.side_effect = [{'course_id': course, 'chapters': [chapter]}, True]
    repo.material.return_value = material()
    service = SimpleNamespace(create=AsyncMock(return_value=({'session': {'id': session}}, 'operation')), run=AsyncMock())
    tasks = BackgroundTasks()
    with patch('study_paths.Service', return_value=service), patch('workflow.durable_enabled', return_value=False):
        result = await start(UUID(path), UUID(chapter['id']), tasks, (user, 'token'), repo)
    assert result == {'session_id': session}
    request = service.create.call_args.args[2]
    assert request.scope.unit_ids == chapter['unit_ids']
    assert request.idempotency_key == uuid5(UUID(path), chapter['id'])
    assert request.familiarity == 'new'
    assert repo._rpc.call_args.args == ('study_path_link_session', {'p_user': user, 'p_id': path, 'p_chapter': chapter['id'], 'p_session': session})
    assert len(tasks.tasks) == 1


@pytest.mark.anyio
async def test_partial_finished_session_restarts_with_stable_new_command_key():
    user, course, path, previous, session = map(str, [uuid4(), uuid4(), uuid4(), uuid4(), uuid4()])
    chapter = {**validate_chapters(draft([material()]), [material()])[0], 'session_id': previous, 'session_status': 'completed', 'completed': False}
    repo = AsyncMock()
    repo._rpc.side_effect = [{'course_id': course, 'chapters': [chapter]}, True]
    repo.material.return_value = material()
    service = SimpleNamespace(create=AsyncMock(return_value=({'session': {'id': session}}, None)))
    with patch('study_paths.Service', return_value=service):
        result = await start(UUID(path), UUID(chapter['id']), BackgroundTasks(), (user, 'token'), repo)
    assert result['session_id'] == session
    assert service.create.call_args.args[2].idempotency_key == uuid5(UUID(path), chapter['id'] + ':' + previous)


@pytest.mark.anyio
async def test_changed_source_does_not_silently_start_an_old_chapter():
    chapter = validate_chapters(draft([material()]), [material()])[0]
    repo = AsyncMock()
    repo._rpc.return_value = {'course_id': str(uuid4()), 'chapters': [chapter]}
    repo.material.return_value = {**material(), 'markdown': '새 원문'}
    with pytest.raises(HTTPException) as exc:
        await start(uuid4(), UUID(chapter['id']), BackgroundTasks(), (str(uuid4()), 'token'), repo)
    assert exc.value.status_code == 409
