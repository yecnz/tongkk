from uuid import uuid4
from fastapi import HTTPException
from preparation import build_config, projection
from learning_sessions.source_scope import source_hash
import pytest


def test_preparation_uses_real_source_scope_and_identity():
    user, course = str(uuid4()), str(uuid4())
    material = {'id': 'file:100', 'name': '강의', 'markdown': '<!-- p.1 -->\n첫 개념\n<!-- p.2 -->\n둘째 개념'}
    snapshot, config = build_config(user, course, material, '2')
    assert '첫 개념' not in snapshot and '둘째 개념' in snapshot
    assert config['pages'] == '2'
    assert config['pack']['source_hash'] == source_hash(material['markdown'])
    assert config['summary_identity']['source_hash'] == config['pack']['source_hash']
    with pytest.raises(ValueError):
        build_config(user, course, material, '3')


def test_draft_projection_does_not_expose_pack_answers_or_rubrics():
    projected = projection({'request': {'id': 'r', 'course_id': 'c', 'material_id': 'm', 'config': {'pages': ''}, 'source_snapshot': 'private source'},
        'source_changed': False, 'artifacts': [{'id': 'a', 'kind': 'pack', 'status': 'ready', 'result': {'content': {'concepts': [{'title': '개념', 'reference': 'private answer', 'criteria': ['private rubric']}]}}}]})
    assert projected['artifacts'][0]['preview']['concepts'] == ['개념']
    assert 'private' not in str(projected)
    with pytest.raises(HTTPException):
        projection(None)
