import pytest
from pydantic import ValidationError
from flashcards import GenerateCards, validate_cards


def test_unknown_or_malformed_citations_are_not_linked():
    result = validate_cards({'cards': [
        {'front': 'A?', 'back': 'A', 'source_page': 2},
        {'front': 'B?', 'back': 'B', 'source_page': 9},
        {'front': 'C?', 'back': 'C', 'source_page': True},
    ]}, '<!-- p.2 -->본문', 3)
    assert [card['source_page'] for card in result] == [2, None, None]


@pytest.mark.parametrize('value', [{}, {'cards': []}, {'cards': [None]}, {'cards': [{'front': ' ', 'back': '답'}]}])
def test_invalid_generated_cards_are_rejected(value):
    with pytest.raises(ValueError):
        validate_cards(value, '본문', 8)


def test_request_caps_and_empty_material():
    for kwargs in [{'markdown': ' ' * 30}, {'markdown': '가' * 60001}, {'markdown': '가' * 30, 'count': 21}]:
        with pytest.raises(ValidationError):
            GenerateCards(**kwargs)


def test_powerpoint_slide_citation_is_preserved():
    cards = validate_cards({'cards': [{'front': '정의?', 'back': '답', 'source_page': 3}]},
                           '<!-- Slide number: 3 -->슬라이드 내용', 1)
    assert cards[0]['source_page'] == 3
