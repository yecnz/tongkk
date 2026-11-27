from learning_mate import retrieve


def test_retrieval_keeps_real_source_units_and_limits_context():
    text = '<!-- p.1 -->\n프로세스는 실행 중인 프로그램이다.\n<!-- p.2 -->\n스레드는 실행 흐름이다.'
    hits = retrieve(text, '프로세스')
    assert len(hits) == 1 and hits[0]['page'] == 1
    assert hits[0]['quote'] in text
    assert retrieve(text, '해당없는질문') == []
    assert sum(len(h['quote']) for h in retrieve(('프로세스\n\n' * 5000), '프로세스')) <= 10000
