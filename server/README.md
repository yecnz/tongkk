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
