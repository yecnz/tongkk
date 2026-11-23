# 백엔드 실행 환경

Python 3.12 기준. requirements.in은 직접 의존성, requirements.txt는 전이 의존성까지 버전·해시를 고정한 설치 파일이다. requirements-dev.txt는 같은 런타임 잠금을 포함한다. 지원 문서가 아닌 MarkItDown 외부 서비스·동영상 확장은 설치하지 않는다.

프로젝트 루트에서 로컬 실행:

```sh
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install --require-hashes -r server/requirements-dev.txt
server/.venv/bin/python -m uvicorn main:app --app-dir server --host 127.0.0.1 --port 8000 --reload --reload-dir server
```

LibreOffice, Tesseract(eng·kor), ffmpeg는 운영체제에 별도 설치하거나 아래 컨테이너를 사용한다. 인증·DB·모델 설정은 server/.env.example을 참고해 server/.env에 입력한다. 비밀값을 이미지에 복사하지 않는다.

```sh
docker build -t tongkk-backend -f server/Dockerfile server
docker run --name tongkk-backend --env-file server/.env \
  -p 127.0.0.1:8000:8000 -v tongkk-data:/data tongkk-backend
```

호스트 8000 포트를 사용 중이면 기존 서버를 종료하거나 `-p 127.0.0.1:8001:8000`으로 변경하고 프런트 백엔드 주소를 맞춘다. `/health`는 프로세스 상태 검사이며 DB 연결 검사를 대신하지 않는다. Docker named volume의 /data에 로그인 제한·문서 캐시·사용량 SQLite를 유지한다. 학습·복습 기록은 Supabase에 저장한다. 컨테이너 재시작만으로 DB 마이그레이션이 적용되지는 않는다.

운영 반영 전 Supabase에서 `supabase/migrations`의 미적용 SQL만 시간순으로 적용한다. 운영 DB 전체에 schema.sql을 다시 실행하지 않는다. 새 설치는 schema.sql을 사용한다. 특히 202611230001~006은 요약 식별·학습 이력·개념·복습·통계를 추가한다. 먼저 백업·테스트 환경 검증 후 운영에 반영한다. ALLOW_NO_AUTH는 운영에서 false를 유지한다.

잠금 갱신(uv 사용, 저장소 루트):

```sh
uv pip compile server/requirements.in --python-version 3.12 --universal --generate-hashes -o server/requirements.txt
uv pip compile server/requirements-dev.in --python-version 3.12 --universal --generate-hashes -c server/requirements.txt -o server/requirements-dev.txt
```

잠금 변경 후 새 가상환경에서 전체 pytest·고정 샘플 평가와 Linux Docker 빌드를 검증한다. Docker OS 패키지·기반 이미지 보안 패치는 재빌드 시 갱신한다. Python 잠금이 OS까지 고정하는 것은 아니다.

AI 사용량은 인증된 사용자별 `/usage`에 최근 30일 집계로 제공된다. `AI_USAGE_DB`는 영속 디스크로 지정한다. 비용은 `AI_MODEL_PRICES_JSON`의 실제 응답 모델 ID별 USD/백만 토큰 단가로 계산하며 실제 청구액과 다를 수 있다. 단가·토큰 미확인은 null이며 캐시·할인·추가 과금까지 반영한 청구서는 아니다. 호출 성공·실패는 모델 호출 기준이며 HTTP 재요청과 구분한다. SDK 내부 자동 재시도는 꺼져 있다. 원문·답변·키·오류 본문은 계측 테이블에 저장하지 않는다.

문서 변환 제한: `/convert`와 `/preview/pdf`의 캐시 미적중 작업이 같은 슬롯을 사용한다. `CONVERSION_MAX_CONCURRENT=1`, `CONVERSION_MAX_WAITERS=4`, `CONVERSION_WAIT_SECONDS=10`이 기본이다. 대기열 초과·시간 초과는 429와 Retry-After를 반환한다. 캐시 적중·PDF 미리보기 직접 반환은 무거운 슬롯을 사용하지 않는다. 요청 취소 후 실행 중인 외부 도구가 끝날 때까지 슬롯·임시 파일을 유지한다.

제한은 프로세스별이다. 여러 worker·컨테이너를 사용하면 전체 동시 실행 수는 각각의 제한 합계다. 전체 서버군 제한이 필요하면 별도 작업 큐가 필요하다. 컨테이너는 기본 1 worker로 실행한다. `uvicorn.error.conversion` 구조화 로그는 요청 ID·문서 종류·대기/처리 시간·상태·예외 종류만 담으며 파일명·본문은 포함하지 않는다. 로그 수집기로 평균·실패율·지연을 집계할 수 있다. LibreOffice 자체 타임아웃과 업로드 크기 제한도 계속 적용한다.


## 영속 학습 워커

이 브랜치의 전체 기능은 007~014 마이그레이션을 순서대로 적용한다. 014는 작업 세대 확인·실행 lease·초안 적용·데이터 초기화 권한을 보완한다. API와 별도 워커 프로세스 모두 LEARNING_WORKER_ENABLED=true로 설정한 뒤 서버 디렉터리에서 `python -m worker`를 실행한다. Docker에서는 같은 이미지의 명령을 `python -m worker`로 바꿔 별도 컨테이너를 운영한다. 서버 전용 Supabase 키를 두 프로세스에만 설정한다. 사용자 JWT를 예약 작업에 저장하지 않는다.

전환 전 기존 실행 중 평가가 끝나도록 기다린다. false이면 기존 프로세스 내 BackgroundTasks를 사용하므로 서버 재시작 후 자동 실행은 보장하지 않는다. true이면 별도 워커가 필요하다. 워커는 DB에서 작업을 잠그고 lease를 발급받아 처리하며, 중단된 작업은 제한된 횟수로 재개한다. 외부 모델 과금의 정확히 한 번 실행을 보장하지 않는다. 사용자별 자동 복습은 마이페이지에서 별도로 켠다.

자료 자동 준비에는 010~011 마이그레이션도 적용한다. 선택 범위는 12,000자 이내이며 긴 자료는 페이지 범위를 지정한다. 사용자별 하루 준비 초안은 30개까지, 실패한 초안은 최대 3세대까지만 명시적으로 재시도한다. 초안을 확인한 뒤 저장하며, 원문이 변경된 결과는 적용하지 않는다.

## Google Calendar 읽기 전용 연결

013 마이그레이션을 적용한다. Google Cloud에서 Calendar API를 활성화하고 웹 애플리케이션 OAuth 앱을 등록한다. GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET을 서버 환경변수로 설정한다. 프론트와 FRONTEND_ORIGIN을 맞추고 등록된 redirect URI를 정확히 `<FRONTEND_ORIGIN>/integrations/google-calendar/callback`으로 설정한다. 코드 교환은 로그인된 사용자의 JWT로 서버에서 수행하며 Supabase 로그인 콜백과 분리한다.

INTEGRATION_ENCRYPTION_KEY는 `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`로 한 번 생성하고 비밀 저장소에 보관한다. 재시작마다 바꾸지 않는다. 기존 암호문을 이전 키로 복호화·재암호화하기 전에 키를 바꾸면 재연결이 필요하다. 이 값과 OAuth secret을 VITE_ 변수나 저장소에 넣지 않는다.

마이페이지에서 연결 후 일정 가져오기를 누르면 워커가 기본 캘린더의 지난 30일~앞 180일을 읽는다. 최대 1,000개·10페이지를 모두 받아야 기존 스냅샷을 교체한다. 부분 실패는 기존 일정을 보존한다. 외부 일정 쓰기·상시 자동 동기화·복수 캘린더는 지원하지 않는다. 연결 해제는 자격 증명을 즉시 제거하고 늦은 작업을 차단한다. Google 권한 회수 요청 실패 시 앱 연결은 해제되며 계정 권한 관리에서 별도로 회수할 수 있다.

설정 없이 연결 성공을 표시하지 않는다. 실제 OAuth 앱 승인·계정 연결·운영 동기화는 별도 확인이 필요하다.

공식 계약: [Google 웹 서버 OAuth 흐름](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

## 학습 기능 회귀 검증

저장소 루트에서 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`, `npm run test:learning-db`, `npm run test:workflow-db`를 실행한다. 서버에서는 `python -m pytest -q`와 `python scripts/evaluate_quality.py`를 실행한다. CI에도 두 DB 검사를 연결했다.

DB 검사는 자격 증명 없이 격리된 PGlite PostgreSQL에서 수행한다. 기존 스키마의 순차 변경과 새 설치 전체 스키마, 소유권·명령 중복·버전 충돌·만료 작업·늦은 완료·초안 적용·사용자 데이터 초기화를 확인한다. Auth/Storage 기반 시설은 테스트 대역을 사용하며 실제 Supabase 운영 적용을 대신하지 않는다. 모델 응답과 Google HTTP는 대역으로 검증하므로 실제 모델 호출·Google 계정 연결은 별도 환경에서 확인한다.
