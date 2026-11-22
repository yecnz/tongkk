# 현재 백엔드 점검 및 학습 세션 API·DB 설계

코드 기준: main / 4488bd5. 저장소 코드·SQL을 점검한 설계이며 운영 DB에 접속하거나 마이그레이션을 실행하지 않았다.

## 1. 판단

FastAPI + Supabase Postgres/Auth/Storage를 유지한다. 기존 자료·요약·퀴즈 CRUD를 한 번에 서버로 옮기기보다, 신규 학습 세션의 상태·제출·평가·재개를 FastAPI가 관리하도록 추가한다.

현재 백엔드는 AI 생성·변환 API에 가깝다. 인증·입력 검증·모델 응답 검증·테스트가 있지만, 학습 세션을 서버에서 저장하고 여러 요청에 걸쳐 진행시키는 계층은 없다. 따라서 먼저 API 계약과 DB 제약을 설계하고, AI 없이 저장·제출·재개가 되는 경로부터 구현한다.

## 2. 현재 구조

```text
React ── JWT ──> Supabase: 과목·자료·요약·퀴즈·답안·계획 저장
  └──── JWT ──> FastAPI: 문서 변환·AI 생성·채점
                    ├─ Supabase Auth: 사용자 토큰 확인
                    ├─ 모델 제공자
                    └─ 로컬 SQLite: 변환 결과 캐시
```

프론트가 자료 Markdown 등을 API에 보내고, AI 결과를 받은 뒤 Supabase에 저장하는 방식이다. FastAPI에는 애플리케이션 데이터용 repository나 DB 트랜잭션 경로가 없다.

| 영역 | 확인한 상태 | 학습 세션에 대한 판단 |
| --- | --- | --- |
| API | main.py에 업무 경로 11개, 별도 APIRouter 없음 | 신규 패키지·라우터로 분리 |
| 인증 | auth.py에서 Supabase /auth/v1/user 호출로 JWT 확인 | 재사용. 새 경로는 실제 사용자 UUID 필수 |
| 입력 | schemas.py의 Pydantic 모델·길이 제한 | 세션 요청 모델 별도 추가 |
| 출력 | 현재 경로에 명시적 response_model 없음 | 단계별 공개 응답 모델 추가 |
| AI | llm.py의 파싱·검증·스레드풀 처리 | 모델 연결 패턴 활용, 세션 전용 평가 계약 추가 |
| 채팅 | LangGraph InMemorySaver, 사용자별 checkpoint key | 영속적인 세션 상태 저장소로 사용하지 않음 |
| 캐시 | convert_cache.py의 SQLite | 문서 캐시로 유지 |
| CORS | GET·POST·OPTIONS, Authorization·Content-Type 허용 | 별도 출처 호출을 위해 PATCH 추가 |
| 배포 경로 | Vercel /api/* → FastAPI /* | 서버 /learning-sessions, 프론트 기본 /api/learning-sessions |
| DB 변경 관리 | schema.sql 한 파일, migrations 디렉터리 없음 | 신규 변경부터 버전별 SQL 도입 |

채팅 메시지는 프론트가 Supabase에도 저장한다. 프로세스 메모리에 있는 것은 LangGraph 실행 checkpoint이며, 모든 채팅 기록이 메모리에만 있다는 뜻은 아니다.

### 현재 API

| 경로 | 현재 역할 |
| --- | --- |
| POST /convert | 문서 → Markdown·시각 자료 변환 |
| POST /preview/pdf | PDF 미리보기 변환 |
| POST /vision/ocr | 이미지 OCR |
| POST /summarize | 요약 생성 |
| POST /summarize/stream | 요약 스트리밍 |
| POST /agent | AI 튜터 대화 |
| POST /quiz | 정답·해설을 포함한 퀴즈 생성 |
| POST /quiz/grade-subjective | 클라이언트가 보낸 문제·모범답안·학생 답안 채점 |
| POST /quiz/analyze-wrong | 오답 분석 |
| POST /study-plan | D-day·미완료 계획 등을 입력받아 계획 생성 |
| GET /health | 프로세스 생존 응답. DB·모델 연결 확인은 아님 |

학습 세션은 /agent의 대화만으로 구현하지 않는다. 사용자의 질문·답변 메시지와 별개로 현재 단계, 고정된 답안, 도움 사용, 평가 상태가 필요하다.

### 현재 DB

저장소 SQL에는 애플리케이션 테이블 10개가 있다. Auth·Storage 내부 테이블은 이 수에 포함하지 않는다.

| 테이블 | 데이터 | 세션에서의 관계 |
| --- | --- | --- |
| courses | 사용자별 과목 | 기존 과목 ID 참조 |
| materials | 변환 원문·파일 경로·페이지 정보 | 기존 자료를 서버에서 읽음 |
| summaries | 요약 결과 | 기존 요약 기능 유지 |
| summary_chat_sessions / summary_chat_messages | 튜터 대화 | 학습 세션과 별도 |
| quiz_sets / quiz_attempts | 문제 묶음·응시 결과 JSONB | 새 세션 기록과 별도 |
| wrong_answer_analyses | 과목별 최신 오답 분석 1건 | 장기 개념 이력으로 사용하기에는 부족 |
| dashboard_state | 계획·D-day 등의 JSONB | 세션 진행 상태를 추가 저장하지 않음 |
| profiles | 사용자 설정 | 기존 설정 활용 |

기존 테이블에는 RLS가 있다. 일반적인 사용자별 정책은 auth.uid() = user_id를 검사한다. 다만 자식의 user_id와 연결된 과목·자료 소유자가 일치하는지는 일반적인 자기 행 정책만으로 모두 보장되지 않는다. 신규 관계에는 소유자 일치를 DB 제약과 서버 검사로 함께 적용한다. 기존 데이터의 실제 불일치 여부는 확인하지 않았다.

materials의 PK는 (course_id UUID, id TEXT)다. 프론트 자료 ID는 파일명:크기이므로 새 테이블에서 material_id를 UUID로 가정하면 안 된다. 같은 이름·크기라도 내용이 달라질 수 있어 세션에는 원문 해시·스냅샷을 함께 저장한다.

## 3. 신규 데이터 흐름

```text
React → FastAPI 학습 세션 API
          ├─ 검증된 사용자 JWT → 기존 RLS로 원문 읽기
          ├─ 서버 전용 repository → Supabase 세션 테이블·RPC
          └─ 준비·회상 평가 때만 모델 호출

React ← 현재 단계에서 공개할 질문·내 초안·결과·허용 행동
```

클라이언트는 user_id, 정답, 채점 기준, 점수, 다음 phase를 확정하지 않는다. 새 세션 데이터는 API를 통해서만 접근한다. 기존 자료 CRUD까지 일괄 이전하지 않는다.

## 4. API 계약

공통 인증은 Bearer JWT다. 요청 모델은 알 수 없는 필드를 거절한다. 서버 경로 기준이며 scopes는 /{session_id}보다 먼저 등록한다.

| API | 입력·책임 | 응답 |
| --- | --- | --- |
| GET /learning-sessions/scopes | course_id, material_id. 선택 가능한 실제 범위 조회 | source_hash, 페이지·제목·문단 ID |
| POST /learning-sessions | 자료·범위·자료 해시·학습 문맥·목표 시간·개념 수·명령 키 | 준비 필요 시 202 + session_id, operation_id. 준비 완료·재사용이면 현재 상태 |
| GET /learning-sessions | 상태·과목·limit·cursor로 본인 목록 조회 | 가벼운 목록. 원문·답안 본문 제외 |
| GET /learning-sessions/{id} | 본인 세션 복원 | status, revision, 현재 문항·초안, 공개 피드백, allowed_actions |
| PATCH /learning-sessions/{id}/draft | item_id, expected_item_revision, text/선택 값 | 저장된 초안·새 item_revision |
| POST /learning-sessions/{id}/answers | item_id, recall/check, 최신 답안, expected_revision, 명령 키 | 고정된 attempt_id, 평가 중 operation 또는 객관식 결과 |
| POST /learning-sessions/{id}/help | item_id, 도움 종류, expected_revision, 명령 키 | 노출 이력 저장 후 원문·힌트·모범 설명 |
| POST /learning-sessions/{id}/actions | advance/skip/self_check/pause/resume/finish/abandon | 서버가 검증한 새 상태 |
| GET /learning-sessions/{id}/operations/{operation_id} | 본인 작업 상태 확인 | pending/running/succeeded/failed/expired, retryable |
| POST /learning-sessions/{id}/operations/{operation_id}/retry | 허용된 실패 작업, 명령 키·revision | 새 실행 lease 또는 기존 처리 결과 |
| POST /learning-sessions/{id}/items/{item_id}/report | 오류 유형·선택 설명, 명령 키·revision | 확인 필요 표시. 기존 답안 유지 |

수정 명령은 idempotency_key를 JSON body에 넣는다. 초안은 item revision으로 제어한다. 초기 생성에는 아직 session revision이 없으므로 명령 키와 입력 해시를 검사한다. 같은 키·같은 요청은 저장된 결과를 반환하고, 같은 키·다른 요청은 409다. 명령 키 검사는 최신 revision 검사보다 먼저 한다.

생성 요청 예시(설계):

```json
{
  "course_id": "<course UUID>",
  "material_id": "lecture.pdf:245760",
  "scope": {"type": "pages", "pages": [3, 4, 5]},
  "source_hash": "<scopes 응답의 원문 해시>",
  "familiarity": "attended",
  "target_minutes": 15,
  "concept_count": 2,
  "idempotency_key": "<클라이언트가 한 명령마다 생성한 UUID>"
}
```

source_hash는 범위 선택 이후 원문 변경을 감지하는 용도다. 서버가 실제 원문을 다시 읽고 해시를 계산한다. 변경되면 409 SOURCE_CHANGED를 반환한다. body에 원문·모범답안을 받지 않는다. attended/new는 복습/처음 학습을 구분하며, 세부 enum은 구현 계약에서 고정한다.

### 공개 데이터·오류

- 준비 묶음 내부 모델과 응답 모델을 분리한다. SessionView, CurrentRecallView, CurrentCheckView, FeedbackView, OperationView 등을 Pydantic response_model로 명시한다.
- 제출 전 객관식 answer_index·해설, 미래 문항, 미열람 힌트, 전체 채점 기준을 응답에 넣지 않는다. 해당 단계에서 공개한 내용만 반환한다.
- allowed_actions로 화면 버튼을 구성하되 서버가 실행 시 상태를 다시 검사한다.
- 오류 형식: error_code, message, retryable, current_revision/operation_id(해당 시). 세션 전용 프론트 오류 파서를 둔다.
- 401 인증 필요, 404 없음·소유권 없음, 409 상태·revision·원문 충돌, 422 범위·입력 오류, 429 호출 예산·동시 작업 한도, 503 의존 서비스·기능 설정 불가로 구분한다.
- 기존 fetchWithTunnelRetry를 세션의 새 명령에 그대로 적용하지 않는다. 응답 유실 시 같은 키로 조회·재전송한다.

response_model은 출력 검증·필드 제한을 돕는다. 단계별 공개 허용 여부는 public_projection에서 추가로 판단한다. [FastAPI 공식 문서](https://fastapi.tiangolo.com/tutorial/response-model/)

## 5. DB: 신규 테이블 5개

관계형 컬럼에는 ID·소유자·상태·revision·시간·고유 키를 둔다. 버전이 있는 문제 묶음·평가 내용은 JSONB로 저장한다. 모든 데이터를 한 JSONB에 넣거나 기준별 행을 처음부터 모두 정규화하지 않는다.

| 테이블 | 핵심 필드 | 책임 |
| --- | --- | --- |
| learning_session_packs | id, user_id, course_id, material_id, preparation_key, source_hash, selected_scope, source_snapshot, source_units, content, content_version, status, created_at | 원문 스냅샷·비공개 질문/기준/힌트/정답. ready 이후 내용 고정 |
| learning_sessions | id, user_id, course_id, pack_id, familiarity, target_minutes, status, current_item_id, revision, result, created_at, updated_at, completed_at | 한 번의 학습 진행·종료 결과 |
| learning_session_items | id, user_id, session_id, local_concept_id, phase, recall_draft, check_draft, help_state, outcome, quality_report, revision | 개념별 현재 단계·저장 중 답안·도움 노출 |
| learning_session_attempts | id, user_id, session_id, item_id, kind, submission_no, immutable_answer, rubric_result, check_result, assistance, evaluation_method, prior_exposure, policy_version, created_at | 제출 시점 답안과 수행 근거. 제출 원문은 변경 불가 |
| learning_session_operations | id, user_id, session_id, command_key, input_hash, kind, status, lease_token, lease_expires_at, attempt_no, response_ref, error_code, model_id, usage, started_at, finished_at | 중복 실행 방지·처리 상태·재시도·호출 예산 |

attempt의 답변은 고정하되 평가 대기 → 완료 반영은 허용한다. 새 평가 실행은 operation의 실행 번호·lease로 구분하고 실패를 0점으로 저장하지 않는다. 도움 노출은 시도 중 도움·이전 설명·같은 문제의 과거 노출을 구분한다.

### 키·제약·인덱스

1. 신규 ID는 UUID, material_id는 기존 TEXT. 모든 하위 관계의 user_id·course_id 일치를 복합 FK로 확인한다. 필요한 기존 courses(id, user_id), materials(course_id, id, user_id)에 고유 제약을 추가해 참조한다. pack의 과목 소유 관계도 확인한다.
2. 자료 삭제 → pack → session → item/attempt/operation을 cascade 삭제한다. 사용자·과목 삭제에도 같은 규칙을 적용한다. 로컬 미전송 초안은 로그아웃·초기화 시 별도로 지운다.
3. session.current_item_id는 nullable로 시작하고 같은 session의 item만 참조하도록 제약한다. session과 item의 상호 참조는 생성 순서·지연 검사·삭제를 포함해 DB 통합 테스트한다.
4. 준비 키는 사용자별 고유. 원문 해시·범위·개념 수·실제 모델·프롬프트/처리 버전을 포함한다. content가 문맥에 따라 달라지면 familiarity도 포함한다. 실패한 pack은 캐시 적중으로 취급하지 않는다.
5. 같은 사용자·pack의 preparing/active/paused 세션은 부분 고유 인덱스로 중복 생성하지 않는다. completed/abandoned/failed의 새 학습은 허용한다.
6. operation은 UNIQUE(user_id, command_key), attempt는 UNIQUE(item_id, kind, submission_no), item은 UNIQUE(session_id, local_concept_id). 명령 해시는 정규화한 method/path/body에서 계산한다.
7. CHECK로 status/phase/kind, 0 이상의 revision, 개념 수·목표 시간의 허용 범위를 제한한다. 단계 간 전이는 RPC에서 검사한다.
8. 목록에 (user_id, status, updated_at DESC, id), 하위 조회에 session_id/item_id, 동시 실행 검사에 (user_id, status, lease_expires_at) 인덱스를 둔다.
9. 원문 읽기 이후 생성 트랜잭션에서 자료의 소유권·현재 원문 해시를 다시 확인한다. 다른 요청의 자료 변경·삭제와 교차해 잘못된 세션을 만들지 않는다.

### DB 접근 권한

- 신규 5개 테이블은 RLS 활성화 + anon/authenticated 직접 접근 권한 회수. 정답이 있는 테이블에 사용자 select 정책을 열지 않는다.
- 원문 읽기는 검증된 사용자 JWT와 기존 RLS를 활용한다. 신규 저장은 서버 전용 Supabase secret key로 실행하며 브라우저에 전달하지 않는다.
- 서버 전용 호출은 RLS를 우회하므로 모든 repository/RPC가 검증된 user_id로 소유권을 검사한다. 요청 body의 사용자 ID를 사용하지 않는다.
- RPC는 security invoker를 기본으로 하고 PUBLIC/anon/authenticated execute 권한을 명시적으로 회수한다. service_role만 필요한 테이블·함수 접근을 갖도록 한다. 기존 기능의 권한은 일괄 변경하지 않는다.
- 서버 secret key는 apikey에 사용하고 사용자 JWT 요청과 관리자 요청의 클라이언트·헤더를 분리한다. 기존 legacy service_role 키를 쓰는 배포는 해당 인증 방식에 맞춰 설정한다.
- 추가 키가 없으면 신규 기능만 unavailable 처리한다. 현재 로컬 서버 설정에는 URL·anon key가 있고 서버 전용 DB 키·DB 연결 문자열은 확인되지 않았다.

근거: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [함수 권한](https://supabase.com/docs/guides/database/functions), [API 키](https://supabase.com/docs/guides/getting-started/api-keys).

## 6. 중복 제출·모델 작업의 처리

DB REST 호출을 여러 번 순서대로 보내는 것만으로 답안 저장과 단계 이동이 원자적으로 처리되지는 않는다. reserve_command, save_draft, finalize_operation 같은 서버 전용 Postgres 함수로 관련 변경을 한 트랜잭션에 묶는다. 함수 이름은 구현 시 정한다.

1. **예약 트랜잭션:** 같은 키 확인 → 소유권·상태·revision 확인 → 예산/진행 작업 확인 → 답안 고정·operation 생성·phase 갱신. DB 시간과 잠금을 사용한다.
2. **모델 호출:** 트랜잭션을 끝낸 뒤 실행한다. source/rubric/answer는 서버 저장본을 사용한다. 객관식 채점·힌트 공개는 모델을 호출하지 않는다.
3. **완료 트랜잭션:** lease와 attempt 대상 확인 → 결과 검증 → attempt 평가·item 상태·session revision·operation 결과를 함께 반영한다. 삭제·종료·교체된 실행은 진행을 바꾸지 않는다.
4. 사용자별 동시 실행은 사용자 단위 트랜잭션 잠금과 유효 lease 검사로 예약을 직렬화한다. 메모리 semaphore만으로 다중 프로세스를 제어하지 않는다.
5. 202 반환 뒤 실행은 앱 생명주기에 묶인 제한된 비동기 작업으로 처리하고 operation을 먼저 저장한다. 영속 워커가 아니므로 프로세스 종료 시 자동 복구를 보장하지 않는다. 만료 후 명시적 재시도를 제공한다. 자동 재개가 요구되면 별도 영속 큐·워커 설계로 확장한다.
6. 기본 개념 2개는 준비 1회 + 회상 평가 2회, 실패 복구 추가 1회까지 총 4회로 시작한다. SDK 내부 자동 재시도도 끄거나 호출 예산에 포함한다.
7. DB 저장 뒤 응답 유실은 같은 명령 결과로 복원한다. 모델 응답을 DB에 저장하기 전 프로세스가 사라지면 미평가로 남는다. 외부 모델 과금의 정확히 한 번 실행은 보장하지 않는다.

초기에는 기존 httpx로 Supabase REST/RPC repository를 구성할 수 있다. 원자성이 필요한 부분을 RPC에 두므로 새 ORM·별도 DB를 필수 도입하지 않는다. 관리자 클라이언트는 앱 생명주기에서 재사용하고 timeout·오류 변환을 통일한다.

## 7. 서버 파일 구성과 구현 순서

```text
server/learning_sessions/
  router.py              # 인증·입출력·HTTP 상태
  schemas.py             # 요청·공개 응답 모델
  service.py             # 생성·제출·도움·진행 조정
  repository.py          # 소유권을 포함한 DB 접근·RPC
  policy.py              # 상태 전이·호출 예산·공개 규칙
  source_scope.py        # 엄격한 범위·원문 단위·해시
  pack_generation.py     # 준비 생성·구조/출처 검증
  feedback.py            # 자기 설명 평가·근거 검증
  public_projection.py   # 단계에 따른 공개 필드
```

main.py에는 라우터 등록·PATCH CORS 허용만 최소 추가한다. config.py·auth.py에는 신규 기능 설정·실제 사용자와 JWT를 전달할 인증 컨텍스트를 추가한다. 현재 개발용 ALLOW_NO_AUTH에서 None을 반환하는 경우도 새 저장 API는 거절한다.

| 순서 | 구현 | 완료 기준 |
| --- | --- | --- |
| 1 | 상태·요청·공개 응답 계약, 고정 fixture | 프론트가 실제 API 형태로 한 세션을 표현 가능 |
| 2 | 버전별 SQL, 권한, repository/RPC | 실제 테스트 DB에서 소유권·삭제·동시성 확인 |
| 3 | AI 없는 세션 생성·초안·제출·진행·복원 | 새로고침·중복 제출·다른 탭 충돌 처리 |
| 4 | 원문 범위·스냅샷·pack 준비·operation | 원문 변경·없는 페이지·준비 실패 처리 |
| 5 | 기준별 회상 평가·힌트·객관식 확인 | 정답 공개 시점·미평가·호출 예산 확인 |
| 6 | 자료 시작 버튼·대시보드 재개·소규모 파일럿 | 실제 자료로 질문·정답·학습 흐름 검토 |

전 과목 개념 그래프·장기 기억 점수·복습 스케줄 테이블은 이번 세션 MVP의 선행 조건으로 추가하지 않는다. 세션의 local_concept_id와 출처·정책 버전을 보존해 이후 개념 연결을 위한 근거를 남긴다.

## 8. 검증 결과와 남은 확인

- 기존 서버 테스트: **132 passed, 7 warnings**. 변환 캐시는 임시 디렉터리로 분리해 실행했다.
- 이 테스트는 실제 운영 DB 권한·저장 트랜잭션·동시성·실제 모델 품질을 검증하지 않는다. 인증·모델을 대체한 테스트가 포함된다.
- 운영 DB 연결 도구·관리자 키가 없어 실제 배포 스키마, 정책, 데이터 양, 쿼리 성능은 미확인이다. DB 평가는 supabase/schema.sql 기준이다.
- 신규 필수 DB 테스트: 다른 사용자 API 접근 거부, 브라우저 직접 테이블/RPC 접근 거부, 같은 제출 동시 요청 1건 저장, revision 충돌, 만료 lease의 늦은 응답 거부, 자료/과목/계정 삭제 cascade.
- 현재 requirements.txt는 >= 범위이며 pymupdf가 중복이다. 환경 고정은 기존 운영 개선 과제로 유지하고 신규 DB 통합 테스트 환경을 명시한다.
- 기존 주관식 score/is_correct 불일치, 요약 저장 키, 문서 변환 동시 실행 제한은 별도 품질 과제다. 신규 세션 경로에는 같은 문제를 만들지 않는 계약을 적용한다.

관련 문서: [학습 세션 구현 계획](learning-session-implementation-plan.md), [자체 검토](learning-session-plan-review.md).
