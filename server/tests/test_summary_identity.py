from uuid import uuid4
import pytest
from summary_identity import PrepareSummary, prepare_identity


def request(**extra):
    data = dict(course_id='00000000-0000-0000-0000-000000000001', materials=[{'id': 'a', 'name': '자료'}],
                markdown='<!-- p.1 -->\n정의\n<!-- p.2 -->\n예제', pages='1-2')
    data.update(extra)
    return PrepareSummary(**data)


def test_equivalent_ranges_and_trimmed_instructions_have_same_key():
    assert prepare_identity(request(pages='2,1', focus_prompt=' 핵심 '), 'u') == prepare_identity(request(focus_prompt='핵심'), 'u')


@pytest.mark.parametrize('change', [dict(markdown='<!-- p.1 -->\n바뀜\n<!-- p.2 -->\n예제'), dict(pages='1'), dict(focus_prompt='다른 지시'), dict(template='CHEAT_SHEET')])
def test_changed_inputs_do_not_reuse_old_summaries(change):
    assert prepare_identity(request(**change), 'u')['request_key'] != prepare_identity(request(), 'u')['request_key']


def test_owner_course_and_model_are_part_of_identity(monkeypatch):
    original = prepare_identity(request(), 'u')
    assert original != prepare_identity(request(), 'other')
    assert original != prepare_identity(request(course_id=uuid4()), 'u')
    monkeypatch.setenv('OPENAI_MODEL', 'changed-model')
    assert original != prepare_identity(request(), 'u')


@pytest.mark.parametrize('pages', ['-1', '1x', '3', '1-1000000000', '1,,2'])
def test_invalid_pages_never_silently_summarize_everything(pages):
    with pytest.raises(ValueError):
        prepare_identity(request(pages=pages), 'u')
