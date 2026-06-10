# Rate Limiting (slowapi) 적용 가이드 — 나중에 추가용

> 보안 점검 6번(LLM 비용 남용/금전적 DoS 방어) 후속. 지금은 보류했고, **앱을 불특정 다수에게 공개하거나 누가 API를 자동/반복 호출할 가능성이 보일 때** 적용한다.
> 현재는 입력 길이 상한(`MAX_MARKDOWN_CHARS` 등)으로 "한 번 호출당 비용"은 이미 묶여 있음. rate limiting은 "호출 빈도"를 막는 추가 방어.

대상 파일: `server/main.py`, `server/requirements.txt`, `server/.env.example`

---

## 핵심 개념

- **사용자별 카운트**: 호출자를 로그인 토큰(JWT) 기준으로 구분해 각자 횟수를 따로 센다. 폭주한 사람만 429로 막고 나머지는 정상.
- **IP 폴백 주의**: 이 앱은 Vercel을 거쳐 와서 모든 요청이 같은 IP로 보인다. 그래서 기본 IP 기준으로 하면 한 명 폭주에 전원 차단됨. 토큰이 없을 때만 `X-Forwarded-For`의 원 IP로 폴백한다.
- **토큰은 해시해서** 키로 쓴다(평문이 메모리·로그에 남지 않게).
- 단일 EC2면 메모리 저장으로 충분(Redis 불필요). 서버 재시작 시 카운터 리셋되지만 폭주 방어 목적엔 OK. 여러 대로 늘리면 그때 Redis 백엔드로 교체.

---

## 1) 의존성 — `server/requirements.txt`

```
slowapi>=0.1.9
```

EC2에서: `pip install -r server/requirements.txt` 후 백엔드 재시작 필수.
(설치 안 하면 `ModuleNotFoundError: slowapi`로 서버가 안 뜸 — 아래 "선택적 import"를 쓰면 회피 가능)

---

## 2) import — `server/main.py` 상단

```python
import hashlib  # 토큰 해시용

from fastapi import Request  # 기존 fastapi import에 Request 추가
from fastapi.responses import JSONResponse  # 기존 responses import에 추가
```

### (권장) 선택적 import — slowapi 미설치 환경에서도 서버가 뜨게

`from agent import ...` 아래에 둔다:

```python
try:
    from slowapi import Limiter
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address
    _SLOWAPI_AVAILABLE = True
except ImportError:
    _SLOWAPI_AVAILABLE = False
```

---

## 3) Limiter 설정 — `app.add_middleware(CORS...)` 블록 뒤, `md_converter = MarkItDown()` 앞

```python
if _SLOWAPI_AVAILABLE:
    def _rate_limit_key(request: Request) -> str:
        # 로그인 토큰 있으면 사용자별, 없으면 X-Forwarded-For 원 IP로 카운트
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
            if token:
                return "user:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return "ip:" + forwarded.split(",")[0].strip()
        return "ip:" + get_remote_address(request)

    limiter = Limiter(key_func=_rate_limit_key)  # ※ headers_enabled=True는 쓰지 말 것(엔드포인트에 response 인자 강제됨)
    app.state.limiter = limiter

    async def _rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"detail": "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요."},
        )

    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded)
else:
    logger.warning("slowapi 미설치 — rate limiting 비활성화 (pip install slowapi 후 재시작 시 활성화)")

    class _NoopLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    limiter = _NoopLimiter()
```

한도 상수(엔드포인트별 분당, env로 조정 가능):

```python
RATE_LIMIT_CONVERT = os.getenv("RATE_LIMIT_CONVERT", "10/minute")
RATE_LIMIT_PREVIEW = os.getenv("RATE_LIMIT_PREVIEW", "20/minute")
RATE_LIMIT_OCR = os.getenv("RATE_LIMIT_OCR", "20/minute")
RATE_LIMIT_SUMMARIZE = os.getenv("RATE_LIMIT_SUMMARIZE", "20/minute")
RATE_LIMIT_AGENT = os.getenv("RATE_LIMIT_AGENT", "30/minute")
RATE_LIMIT_QUIZ = os.getenv("RATE_LIMIT_QUIZ", "20/minute")
RATE_LIMIT_GRADE = os.getenv("RATE_LIMIT_GRADE", "40/minute")
RATE_LIMIT_ANALYZE = os.getenv("RATE_LIMIT_ANALYZE", "20/minute")
RATE_LIMIT_STUDY_PLAN = os.getenv("RATE_LIMIT_STUDY_PLAN", "20/minute")
```

---

## 4) 각 엔드포인트에 데코레이터 + `request: Request` 인자 추가

데코레이터 순서: `@app.post(...)`(맨 위) → `@limiter.limit(...)` → 함수.
함수 시그니처 **첫 인자로 `request: Request`** 를 넣어야 slowapi가 인식한다.

```python
@app.post("/summarize")
@limiter.limit(RATE_LIMIT_SUMMARIZE)
async def summarize(request: Request, req: SummarizeRequest, _user=Depends(require_api_user)):
    ...
```

적용 대상 9개 엔드포인트:

| 엔드포인트 | 함수 | 한도 상수 |
|---|---|---|
| `/convert` | `convert_document_to_markdown` | `RATE_LIMIT_CONVERT` |
| `/preview/pdf` | `convert_document_to_pdf_preview` | `RATE_LIMIT_PREVIEW` |
| `/vision/ocr` | `extract_text_with_google_vision` | `RATE_LIMIT_OCR` |
| `/summarize` | `summarize` | `RATE_LIMIT_SUMMARIZE` |
| `/agent` | `agent` | `RATE_LIMIT_AGENT` |
| `/quiz` | `generate_quiz` | `RATE_LIMIT_QUIZ` |
| `/quiz/grade-subjective` | `grade_subjective_answer` | `RATE_LIMIT_GRADE` |
| `/quiz/analyze-wrong` | `analyze_wrong_answers` | `RATE_LIMIT_ANALYZE` |
| `/study-plan` | `generate_study_plan` | `RATE_LIMIT_STUDY_PLAN` |

> 파일 업로드 엔드포인트(convert/preview/ocr)는 시그니처가 여러 줄(`file: UploadFile = File(...)`)이므로,
> `request: Request,` 를 첫 줄로 추가하면 된다.
> `/health`에는 붙이지 않는다(헬스체크는 제한 불필요).

---

## 5) `server/.env.example` 문서화 (선택)

```
# 사용자별(로그인 토큰 기준, 없으면 IP) 분당 호출 한도. 폭주/비용 남용 방어용.
RATE_LIMIT_CONVERT=10/minute
RATE_LIMIT_SUMMARIZE=20/minute
RATE_LIMIT_AGENT=30/minute
# ... (나머지 동일)
```

---

## 검증 방법

slowapi 설치 후, 같은 토큰으로 한도+α번 연속 호출 → 한도 초과분이 **429 + `{"detail":"요청이 너무 잦습니다..."}`** 로 막히고,
**다른 토큰**으로는 정상(200)이면 사용자별 격리 OK.

```python
# TestClient로 빠르게 확인
codes = [client.post("/summarize", headers={"Authorization":"Bearer A"}).status_code for _ in range(한도+2)]
# 기대: [200, 200, ..., 429, 429]
```

## 주의사항 (실제로 겪은 함정)

- **`Limiter(headers_enabled=True)` 쓰지 말 것** — 응답에 한도 헤더를 주입하려고 모든 엔드포인트에 `response: Response` 인자를 강제한다(`parameter response must be an instance of starlette.responses.Response` 에러). 기본값(False)이면 그냥 동작.
- 프론트(`src/services/backend.ts`의 `parseApiError`)는 429를 `detail` 문구로 표시하므로, 위 한국어 메시지가 사용자에게 그대로 노출된다.
