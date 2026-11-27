# Tongkk 보안 및 QA 점검

2026년 11월 26일 KST 기준. 프론트엔드, FastAPI, Supabase 스키마와 마이그레이션, Tauri URL 처리, 잠금 의존성을 점검하고 재현 가능한 문제를 수정했다. 최종 프론트엔드 323개·서버 326개 테스트, 격리 DB 검사, 품질 평가, 데스크톱·모바일 브라우저 검사가 통과했다.

**수정은 로컬 작업 트리에 있다. 운영 DB 마이그레이션·배포는 수행하지 않았다.** 실제 운영 설정, 네이티브 macOS 실행, Docker 이미지 및 외부 문서 변환 도구는 아래 검증 범위에 포함되지 않는다. 따라서 운영 환경의 모든 취약점이 제거됐다는 의미는 아니다.

## 수정한 보안 문제

높음은 다른 사용자의 작업 방해, 서버 자원 고갈 또는 위험한 로컬 URL 실행으로 이어지는 경로를 뜻한다. 중간은 계정 전환 시 정보 잔존과 내부 정보 노출이다. 등급은 이 저장소의 영향에 대한 판단이며 공식 CVSS 점수가 아니다.

| 문제 | 영향 | 수정과 검증 |
| --- | --- | --- |
| DB 참조 소유권 누락 | 높음. 자신의 `user_id`를 유지한 채 다른 사용자 과목을 참조하는 행을 저장할 수 있었다. 타인 오답 분석의 UNIQUE 슬롯 선점으로 정상 저장 실패를 재현했다. | `202611260005_reference_ownership.sql`에서 12개 복합 외래키와 기존 자료 채팅의 소유권 정책 추가. 신규 설치 스키마에도 반영. 소유권·정상 저장·삭제·RPC·Storage 37개 검사 통과. |
| 요청 본문 파싱 전 크기 제한 부재 | 높음. 엔드포인트의 파일 크기 검사가 multipart 파싱 뒤에 수행되어 요청 전체에 대한 자원 한도가 부족했다. | ASGI 미들웨어에서 선언 길이와 실제 누적 수신 바이트 제한. chunked·과소신고·추가 파일도 검사하고 중단된 임시파일이 닫히는지 검증. |
| 페이지 범위 전개 제한 부재 | 높음. 짧은 범위 문자열로 매우 큰 `range`를 집합에 넣어 메모리를 소진할 수 있었다. | 전개 전에 입력 4,000자, 범위·합계 10,000페이지 한도 적용. 큰 할당 없이 검증 순서를 검사하는 회귀 테스트 추가. |
| PDF 렌더링 크기 제한 부재 | 높음. 작은 PDF의 비정상 MediaBox가 거대한 픽셀 버퍼 할당을 유도했다. | 실제 렌더링 경계의 픽셀 면적을 `get_pixmap` 호출 전에 검사. 작은 실제 PDF와 호출 감시로 검증. |
| 이미지 파서 의존성 취약점 | 높음. Pillow 12.2.0에 이미지 파싱 자원 고갈 관련 공지가 적용됐다. | Pillow 13.0.0으로 갱신하고 확장자별 디코더만 허용. 해시 잠금 재생성 및 전체 서버 회귀 통과. |
| Tauri URL 신뢰 경계 누락 | 높음. 외부 origin의 `/auth`를 앱 내부로 열거나 임의 scheme을 macOS `open`에 전달할 수 있었다. | 앱과 동일한 origin만 내부 탐색 허용. 외부 열기는 HTTP·HTTPS·mailto만 허용하고 사용자정보가 포함된 URL 차단. Rust 테스트 3개 추가했으나 이 PC에서 실행하지 못했다. |
| 비공개 자료·서명 URL 캐시 잔존 | 중간. 로그아웃 이후에도 원본 자료와 접근 URL이 같은 브라우저에 남았다. | 사용자별 Cache Storage, 전환 시 삭제, 경로 소유권 검사, 진행 중 응답 무효화. 별도 HTTP 캐시에는 `no-store` 적용. |
| 퀴즈 초안 계정 혼합 | 중간. 사용자 식별자 없는 질문·답안 초안을 다음 계정에서 복원할 수 있었다. | 초안에 `userId` 저장·검증, 계정 전환 시 제거, 이전 계정의 늦은 effect 쓰기 거부. 같은 계정 새로고침 복구는 유지. |
| 과목 목록의 계정 전환 경쟁 조건 | 중간. 이전 계정의 늦은 조회 응답이 새 계정 화면 상태에 반영될 수 있었다. | 사용자별 Provider 재마운트로 상태와 비동기 응답의 수명 분리. 지연 응답 회귀 검사 추가. |
| 공급자 오류 원문 노출 | 중간. 인증·OCR·문서 변환·LLM 오류 메시지에 내부 경로나 공급자 상세 정보가 포함될 수 있었다. | 외부 응답은 정해진 오류 메시지로 교체. 합성 비밀값이 응답에 포함되지 않는지 검증. 인증 응답의 상태·JSON·사용자 ID도 검사. |

Pillow 수정 버전과 영향은 [프로젝트 보안 공지](https://github.com/python-pillow/Pillow/security/advisories/GHSA-wqgw-9xfh-qf2g)를 참고한다. LangGraph도 1.2.4 → 1.2.14, 이에 필요한 LangChain Core는 1.4.6 → 1.4.7로 올렸다. [LangGraph 공지](https://github.com/langchain-ai/langgraph/security/advisories/GHSA-3fx2-cqw9-xr3c)의 실제 악용에는 특정 RemoteGraph/SDK 사용 조건이 필요하며, 기존 잠금의 SDK 0.4.14는 이미 해당 SDK 수정 범위에 있었다. 이번 저장소에서 그 경로의 악용을 재현한 것은 아니다.

## 최종 검증 결과

| 검사 | 결과 |
| --- | --- |
| 전체 프론트엔드 Vitest | 55개 파일, 323개 테스트 통과 |
| 전체 서버 pytest | 326개 통과 |
| 결정적 품질 평가 | 17/17 통과, 모델 호출 0회 |
| 학습 DB 회귀 | 200개 검사 통과 |
| 전체 workflow 스키마 | 85개 검사 통과 |
| 학습 코스 DB | 23개 검사 통과 |
| 암기 카드 DB | 소유권·RLS·중복 요청·스케줄·원본 삭제 검사 통과 |
| 요약 마이그레이션 DB | 이력·기존 데이터 보존·중복 방지 검사 통과 |
| 신규 DB 보안 검사 | 37개 검사 통과 |
| TypeScript | 최종 `tsc -b` 통과 |
| ESLint와 색상 검사 | 오류 0개, 기존 Quiz Hook 경고 4개. 233개 파일의 색상 검사 통과 |
| 최종 프로덕션 빌드 | 통과. 큰 번들 경고는 남음 |
| 기존 프로모 산출물 회귀 | 데모·전체 흐름·9개 기능 화면 통과. 프로모 소스 재번들은 이번 검사에서 수행하지 않음 |
| 실제 Chrome 브라우저 | 6개 경로 × 데스크톱·모바일 = 12개 화면 통과. 런타임·콘솔·로컬 자산 오류 0 |
| Python 설치 일관성 | 해시 검증 설치 및 `pip check` 통과 |
| 변경 공백 검사 | `git diff --check` 통과 |

브라우저 검사는 합성 Supabase 설정으로 별도 임시 빌드를 만들고 외부 요청을 차단했다. `/`, `/auth`, `/teachers`, `/flashcards`, `/study-paths`, `/mini`를 1440×900과 390×844에서 확인했다. 잘못된 로그인 입력이 네트워크 요청 없이 차단되는 것도 확인했다. 실제 계정 로그인·유료 모델·운영 데이터 접근은 하지 않았다. [브라우저 결과](browser-smoke.json), [재현 스크립트](browser-smoke.mjs), [데스크톱 로그인 화면](browser-auth-desktop.png), [모바일 교수자 화면](browser-teachers-mobile.png).

전체 서버 검사에서 드러난 Windows 시간대 데이터 누락은 `tzdata==2026.6` 조건부 의존성으로 수정했다. 품질 테스트가 Windows 기본 문자 인코딩으로 UTF-8 fixture를 읽던 문제도 수정했다.

## 의존성과 비밀정보 검사

- npm 잠금의 571개 이름·591개 버전을 npm 공식 Bulk Advisory API에 조회했다. 일치 공지는 0건이었다. 로컬 npm 실행 파일이 없어 npm CLI 대신 [동일 공식 엔드포인트](https://docs.npmjs.com/cli/audit/)를 직접 사용했다. npm의 전체 메타 취약점 계산을 실행했다는 뜻은 아니다.
- 패치 후 Python 운영·개발 잠금 96개 패키지를 OSV에 조회했고 일치 공지는 0건이었다. [최종 결과](python-audit-after.json).
- Rust 잠금 512개 패키지를 OSV에 조회했다. `glib 0.18.5`의 [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)와 5개 패키지의 유지보수 중단 공지를 확인했다. 이는 아래 남은 항목에 기록했다. [최초 전체 조회](dependency-audit.json)는 수정 전 상태다.
- Git 추적 텍스트 465개 파일에서 개인키·AWS·GitHub·OpenAI·Google·Supabase secret 형태를 검사해 일치 항목이 없었다. 2MB 초과 파일과 비텍스트 파일은 이 검사에서 제외했다. 로컬 Git 이력의 코드·설정 파일에서도 개인키/AWS/GitHub/Supabase secret 패턴 일치를 찾지 못했다. 패턴 검사는 비밀정보 부재를 증명하지 않는다.

CI에 npm 보안 검사, 신규 DB 보안 검사, `pip check`를 추가하고 GitHub 작업 권한을 `contents: read`로 명시했다. CI 변경 자체는 로컬 파일에 있으며 원격 실행 결과는 아직 없다.

## 운영 적용과 남은 위험

1. **DB 반영 필요.** 기존 DB의 선행 마이그레이션 상태를 확인한 뒤 `202611260005_reference_ownership.sql`을 적용해야 소유권 수정이 효력을 갖는다. `NOT VALID` 제약은 기존 행을 삭제하지 않고 신규·변경 참조부터 검사한다. 과거 잘못 연결된 행을 별도로 감사·수정한 후 12개 제약에 `VALIDATE CONSTRAINT`를 실행해야 한다. 신규 설치는 최신 `schema.sql`을 사용한다.
2. **서버·웹·macOS 앱 배포 필요.** 서버는 갱신된 해시 잠금으로 재설치하거나 이미지를 재빌드해야 한다. 웹을 다시 배포하고 Tauri URL 정책은 macOS 앱을 다시 빌드·배포해야 반영된다.
3. **AI 사용량 악용 방어가 남음.** 직접 요약·퀴즈·튜터·OCR 요청의 사용자별 빈도·비용 상한은 코드에 없다. 요청 크기 제한과 사용량 집계는 비용 차단을 대신하지 않는다. 운영 프록시의 연결 수·시간·IP 제한 및 Supabase 자체 Auth 제한과 함께 점검해야 한다.
4. **문서 변환 격리 확인 필요.** LibreOffice·Tesseract·ffmpeg 실물 실행, 컨테이너 OS 패치, 문서 처리 프로세스의 네트워크·파일 접근 격리는 확인하지 않았다. Python 단위 테스트의 변환 대역은 이 검사를 대신하지 않는다.
5. **HTTP CSP 보강 필요.** Vercel 응답에 CSP가 없고 Tauri의 `csp`도 `null`이다. Markdown XSS 회귀는 통과했으나, 인라인 초기화·PDF worker·CDN 폰트와 호환되는 응답 CSP 검토가 남는다. 원격 웹을 읽는 Tauri는 로컬 설정만으로 원격 응답 CSP가 적용됐다고 볼 수 없다.
6. **Rust 플랫폼 검증 필요.** 이 환경에는 Cargo가 없어 추가 Rust 테스트 3개와 네이티브 빌드는 미실행이다. `glib` 문제는 Tauri의 Linux/BSD GTK 의존 경로로 확인되어 현재 macOS 배포 대상에는 적용되지 않는 것으로 추정하지만, 실제 플랫폼별 `cargo tree`로 검증하지 않았다. Linux 배포 전 해소해야 한다. `chrono`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`의 유지보수 중단도 추적 대상이며 모두 직접 악용 취약점이라는 의미는 아니다.
7. **기능 품질의 남은 경고.** Quiz의 Hook 의존성 경고 4개와 약 1.8MB 메인 JavaScript 번들 경고가 있다. 실계정 OAuth 연결·Supabase 운영 정책·실제 AI 답변 품질·macOS 앱 상호작용은 별도 환경에서 검증해야 한다.

## 로컬 재현

일반 개발 환경에서는 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`, `npm run test:security-db` 및 기존 네 가지 DB 스크립트를 실행한다. 서버는 Python 3.12 가상환경에 `requirements-dev.txt`를 `--require-hashes`로 설치한 후 `python -m pytest -q`와 `python scripts/evaluate_quality.py`를 실행한다.

이 PC에서는 npm 경로가 없어 로컬 패키지의 Node 진입점을 직접 실행했다. 메모리 제약에는 Vitest `--maxWorkers=1 --no-file-parallelism --pool=threads`, DB 검사에는 Node `--liftoff-only --wasm-lazy-compilation --disable-wasm-trap-handler`를 사용했다. Windows 샌드박스가 asyncio의 로컬 socketpair를 막아 서버 테스트가 대기하던 문제는 승인된 로컬 실행으로 해소했다. 이 환경 문제로 중단된 실행은 통과 수에 포함하지 않았다.

작업 시작 전에 있던 `src/App.tsx`, `src/TutorialContext.tsx`, `src/common.tsx`, 교수자 기능과 UI 점검 메모의 변경은 보존했다. 보안 커밋에는 이 기존 변경을 포함하지 않는다. 위 테스트 수치와 `/teachers` 브라우저 결과·스크린샷은 기존 변경이 포함된 당시 작업 트리 기준이며, 독립된 보안 커밋만의 교수자 기능 검증 증거는 아니다.
