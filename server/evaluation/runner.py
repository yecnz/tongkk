import json
from collections import defaultdict
from pathlib import Path
from grading import normalize_subjective_score, SUBJECTIVE_PASS_SCORE
from llm import _validate_quiz_questions
from learning_sessions.generation import validate_feedback
from summary_quality import inspect_summary

DEFAULT_FIXTURES = Path(__file__).with_name('fixtures.json')


def evaluate(fixtures):
    results = []
    difficulties = defaultdict(lambda: {'samples':0,'valid':0,'key_matches':0})
    for case in fixtures['summary']:
        warnings = inspect_summary(case['text'], set(case['pages']))
        actual = sorted(w['code'] for w in warnings)
        results.append({'id':case['id'],'group':'summary','passed':actual == sorted(case['expected']), 'warnings':warnings})
    for case in fixtures['quiz']:
        valid, key_correct = False, False
        try:
            questions = _validate_quiz_questions(case['output'], case['type'])
            valid = True
            key_correct = questions[0]['answer'] == case['reference_answer']
        except ValueError:
            pass
        group = difficulties[case['difficulty']]
        group['samples'] += 1; group['valid'] += int(valid); group['key_matches'] += int(key_correct)
        results.append({'id':case['id'],'group':'quiz','passed':valid == case['expected_valid'] and key_correct == case['expected_key_correct'],
                        'valid':valid,'key_matches_reference':key_correct})
    for case in fixtures['grading']:
        scores = []
        for score in case['scores']:
            try: scores.append(normalize_subjective_score(score))
            except ValueError: scores.append(None)
        passed = [None if s is None else s >= SUBJECTIVE_PASS_SCORE for s in scores]
        results.append({'id':case['id'],'group':'grading','passed':scores == case['expected_scores'] and passed == case['expected_pass'],
                        'normalized_scores':scores,'decision_stable':len(set(passed)) == 1 if None not in passed else None,
                        'score_spread':max(scores)-min(scores) if None not in scores else None})
    for case in fixtures['feedback']:
        source = [{'id':'u0','text':case['source']}]
        raw = {'criteria':[{'criterion_id':'c1','status':case['status'],'reason':'시간 간격의 설명을 확인해요.',
                           'student_quote':case['student_quote'],'source_refs':[{'unit_id':'u0','quote':case['quote']}]}]}
        valid = True
        try: validate_feedback(raw, {'criteria':[{'id':'c1'}]}, source, case['answer'])
        except ValueError: valid = False
        results.append({'id':case['id'],'group':'feedback','passed':valid == case['expected_valid'],'valid':valid})
    return {'fixture_version':fixtures['version'], 'mode':'offline', 'provider_calls':0, 'cases':len(results),
            'passed':sum(r['passed'] for r in results), 'failed':sum(not r['passed'] for r in results),
            'synthetic_quiz_by_difficulty':dict(difficulties), 'results':results,
            'limits':['회귀 검사 결과이며 실제 모델 정확도나 학생 정답률이 아니다.',
                      'OCR 인용 일치 여부를 검사하며 OCR 복원·의미 정확도를 측정하지 않는다.',
                      '채점 안정성은 고정 응답 샘플의 판정 변화이며 실시간 반복 호출 실험이 아니다.']}


def load_and_evaluate(path=DEFAULT_FIXTURES):
    return evaluate(json.loads(Path(path).read_text(encoding='utf8')))
