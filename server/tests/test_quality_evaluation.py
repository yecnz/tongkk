import copy
import json
import subprocess
import sys
from pathlib import Path
from evaluation.runner import DEFAULT_FIXTURES, evaluate, load_and_evaluate


def test_fixed_fixture_report_exposes_boundary_instability_and_wrong_key():
    report=load_and_evaluate()
    assert report['cases']==17 and report['failed']==0 and report['provider_calls']==0
    rows={r['id']:r for r in report['results']}
    assert rows['grade-boundary-instability']['decision_stable'] is False
    assert rows['quiz-transfer-wrong-key']['key_matches_reference'] is False
    assert rows['source-ocr-noise']['valid'] is False


def test_changed_expectations_fail_the_cli_and_export_report(tmp_path):
    fixtures=copy.deepcopy(json.loads(DEFAULT_FIXTURES.read_text()))
    fixtures['quiz'][0]['reference_answer']=1
    path=tmp_path/'fixtures.json';path.write_text(json.dumps(fixtures))
    output=tmp_path/'result.json'
    script=Path(__file__).resolve().parents[1]/'scripts/evaluate_quality.py'
    result=subprocess.run([sys.executable,str(script),'--fixtures',str(path),'--output',str(output)],capture_output=True,text=True)
    assert result.returncode==1 and 'FAILED: quiz-basic' in result.stdout
    assert json.loads(output.read_text())['failed']==1
