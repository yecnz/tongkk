import sys
from pathlib import Path

# 테스트(server/tests/*)가 server/main.py를 그대로 import할 수 있도록 server 디렉터리를 경로에 넣는다.
sys.path.insert(0, str(Path(__file__).resolve().parent))
