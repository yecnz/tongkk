import pytest
from concept_graph import graph_view
from concept_connections import study_plan


def node(key, course='운영체제', state='needs_review', **extra):
    return {'id': key, 'title': '프로세스', 'course_name': course, 'evidence_count': 1,
            'source_changed': False, 'state': state, **extra}


def test_names_alone_do_not_merge_unrelated_source_records():
    value = graph_view({'nodes': [node('a'), node('b', '시스템')], 'links': []})
    assert len(value['groups']) == 2 and not value['suggestions']


def test_saved_aliases_preserve_each_source_history():
    value = graph_view({'nodes': [node('a'), node('b', '시스템')], 'links': [
        {'relation': 'equivalent', 'source_id': 'a', 'target_id': 'b'}]})
    assert len(value['groups']) == 1 and len(value['groups'][0]['members']) == 2
    assert value['groups'][0]['evidence_count'] == 2


def test_identical_cited_definition_links_aliases_automatically():
    refs = [{'unit_id': 'u1', 'quote': '프로세스는 실행 중인 프로그램이며 독립된 주소 공간을 가진다.'}]
    value = graph_view({'nodes': [node('a', source_refs=refs), node('b', state='recent_stable', source_refs=refs)], 'links': []})
    assert len(value['groups']) == 1
    assert value['links'][0]['origin'] == 'automatic'
    assert {m['state'] for m in value['groups'][0]['members']} == {'needs_review', 'recent_stable'}
    assert value['study_plan'][0]['concept_id'] == 'a'


def connected_nodes():
    shared = {'course_id': 'course', 'material_id': 'material', 'source_hash': 'hash'}
    a = node('a', title='자원 할당', source_refs=[{'unit_id': 'u1', 'quote': '자원 할당과 교착 상태를 함께 설명한다.'}], **shared)
    b = node('b', title='교착 상태', source_refs=[{'unit_id': 'u1', 'quote': '교착 상태는 자원을 기다릴 때 발생한다.'}], **shared)
    return a, b


def test_source_connections_do_not_invent_prerequisite_directions():
    a, b = connected_nodes()
    value = graph_view({'nodes': [a, b], 'links': []})
    assert len(value['connections']) == 1 and not value['prerequisites']
    assert {s['concept_id'] for s in study_plan(value, 'b')} == {'a', 'b'}
    assert all('source_refs' not in m for g in value['groups'] for m in g['members'])


def test_prerequisites_come_first_and_unrelated_concepts_are_excluded():
    a, b = connected_nodes()
    value = graph_view({'nodes': [a, b, node('c', title='별도 개념')], 'links': [
        {'relation': 'prerequisite', 'source_id': 'b', 'target_id': 'a'}]})
    assert [s['concept_id'] for s in study_plan(value, 'a')] == ['b', 'a']


def test_stable_related_concepts_are_skipped_but_an_explicit_target_can_be_revisited():
    a, b = connected_nodes(); b['state'] = 'recent_stable'
    value = graph_view({'nodes': [a, b], 'links': []})
    assert [s['concept_id'] for s in study_plan(value, 'a')] == ['a']
    assert {s['concept_id'] for s in study_plan(value, 'b')} == {'a', 'b'}


def test_changed_sources_and_dangling_links_are_not_used():
    a, b = connected_nodes(); a['source_changed'] = True
    edge = {'relation': 'prerequisite', 'source_id': 'a', 'target_id': 'b'}
    value = graph_view({'nodes': [a, b], 'links': [edge, {**edge, 'source_id': 'deleted'}]})
    assert not value['connections'] and not value['recommendations']
    assert not study_plan(value, 'a')
    assert [s['concept_id'] for s in study_plan(value, 'b')] == ['b']


def test_an_automatic_alias_cannot_collapse_a_saved_prerequisite():
    refs = [{'unit_id': 'u1', 'quote': '프로세스는 실행 중인 프로그램이며 독립된 주소 공간을 가진다.'}]
    value = graph_view({'nodes': [node('a', source_refs=refs), node('b', source_refs=refs)], 'links': [
        {'relation': 'prerequisite', 'source_id': 'a', 'target_id': 'b'}]})
    assert len(value['groups']) == 2
    assert [s['concept_id'] for s in study_plan(value, 'b')] == ['a', 'b']


def test_cross_course_coincidence_does_not_create_a_connection():
    a, b = connected_nodes(); b['course_id'] = 'other'
    assert not graph_view({'nodes': [a, b], 'links': []})['connections']


def test_legacy_cycle_is_not_presented_as_a_study_order():
    a, b = connected_nodes()
    value = graph_view({'nodes': [a, b], 'links': [
        {'relation': 'prerequisite', 'source_id': 'a', 'target_id': 'b'},
        {'relation': 'prerequisite', 'source_id': 'b', 'target_id': 'a'}]})
    assert not study_plan(value, 'a')
