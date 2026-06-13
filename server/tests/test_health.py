"""앱이 import되고 라우팅·인증 게이트가 동작하는지 확인하는 스모크 테스트.

main.py 모듈 분할(Stage 6a) 시 앱 구성이 깨지지 않았는지 지키는 회귀 가드 역할.
"""

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200


def test_protected_endpoint_not_open_without_auth():
    # 테스트 환경은 SUPABASE 미설정이라 보호 엔드포인트는 200이 될 수 없다(503/401/422로 차단).
    resp = client.post("/quiz", json={"markdown": "x", "count": 1})
    assert resp.status_code != 200
