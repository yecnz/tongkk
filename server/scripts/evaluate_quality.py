"""Offline, deterministic quality regression report. Never invokes a model."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluation.runner import DEFAULT_FIXTURES, load_and_evaluate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = load_and_evaluate(args.fixtures)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(f"Quality regression: {report['passed']}/{report['cases']} passed; {report['failed']} failed; provider calls=0")
    for result in report['results']:
        if not result['passed']: print('FAILED:',result['id'])
    return int(report['failed'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
