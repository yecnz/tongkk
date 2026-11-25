# Tongkk

대학 강의자료를 올리면 **AI가 요약·퀴즈·튜터링·학습 계획**까지 도와주는 학습 도우미 웹앱입니다.
PDF·PPT·이미지를 Markdown으로 변환하고, 4종 템플릿 요약과 퀴즈/오답노트, 학습 캘린더와 통계를 한곳에서 제공합니다.

- **Frontend** — React 19 + Vite 8 + TypeScript. 로그인과 사용자별 데이터는 **Supabase**(Auth/DB/Storage)가 담당합니다.
- **Backend** — FastAPI. 강의자료 변환, 요약, AI 튜터, 퀴즈, 채점, 학습 계획 등 **AI 처리만** 담당합니다.
- **AI** — OpenAI(GPT) 또는 Google Gemini를 선택해 사용하고, 이미지 텍스트 인식에 Tesseract / Google Vision을 사용합니다.

## 주요 기능

- **강의자료 변환** — PDF·PPT/PPTX·이미지 업로드 → Markdown 추출. 텍스트가 적거나 이미지가 많은 자료는 LLM 비전 분석/OCR로 손글씨·도표까지 읽어 보강합니다.
- **AI 요약 (4종 템플릿)** — 일반 요약(`GENERAL`), 강의 노트(`LECTURE_NOTE`), 마인드맵(`MINDMAP`, 인터랙티브 트리), 치트시트(`CHEAT_SHEET`).
- **AI 튜터** — 자료/요약 기반 멀티턴 Q&A 드로어. 템플릿별 추천 질문과 대화 기록을 자료마다 저장합니다.
- **퀴즈 생성 & 풀이** — 객관식·OX·단답형·주관식, 난이도/문항 수 설정. 주관식은 AI가 점수·피드백으로 채점하고, 시험 모드(타이머)를 지원합니다.
- **오답 노트** — 모든 과목의 오답을 모아 보고, 원본 퀴즈를 재구성해 다시 풀 수 있습니다.
- **암기 카드** — 자료에서 AI 초안을 만들거나 오답을 카드로 저장합니다. 답을 떠올린 뒤 난이도를 평가하면 다음 복습 시점을 계산합니다.
- **학습 코스** — 같은 과목의 자료 여러 개를 챕터로 묶고, 제목·순서·포함 여부를 편집한 뒤 기존 자기 설명 학습을 이어갑니다.
- **원문 출처 바로가기** — 요약·튜터·퀴즈의 페이지 출처에서 PDF의 해당 페이지나 변환 원문을 확인합니다.
- **음성 학습·강의 전사** — 말로 설명한 내용을 편집해 답변에 반영하거나, 강의 녹음·음성 파일을 전사해 학습 자료로 저장합니다.
- **학습 캘린더 & 페이스** — D-day, 할 일, 과목별 진도(페이스)를 월간 캘린더에서 함께 관리합니다. 진도 상태(뒤처짐/정상/앞섬)를 자동 계산합니다.
- **AI 학습 계획** — D-day와 미완료 항목으로 "오늘 할 일"을 작게 쪼개 추천합니다(난이도 모드 조절).
- **학습 통계** — 연속 학습일, 누적 학습 시간, 평균 점수 추이, 취약 주제 Top 5, 과목별 성취도.
- **마이페이지** — 닉네임/아바타, 다크 모드, 계정·데이터 삭제.

## 아키텍처

```
                 ┌──────────────────────────────┐
   브라우저  ──▶ │  Frontend (React + Vite)     │
                 │  - 로그인/데이터: Supabase JS │
                 └───────────┬──────────────────┘
                             │  (개발: /api 프록시, 운영: Vercel 리라이트)
                             ▼
   ┌─────────────┐   AI 처리   ┌──────────────────────────────┐
   │  Supabase   │ ◀────────── │  Backend (FastAPI)           │
   │ Auth/DB/    │  토큰 검증   │  /convert /summarize /agent   │
   │ Storage     │            │  /quiz /study-plan ...        │
   └─────────────┘            └───────────┬──────────────────┘
                                          ▼
                            OpenAI · Gemini · Google Vision
```

- **요청 라우팅** — 프론트는 백엔드를 `VITE_API_URL`로 직접 호출하거나, 미설정 시 `/api` 경로로 호출합니다.
  - 개발: Vite 프록시가 `/api/*` → `http://localhost:8000` 으로 전달합니다(`vite.config.ts`).
  - 운영: Vercel이 `/api/*` → 백엔드 서버로 리라이트합니다(`vercel.json`).
- **인증** — 프론트는 Supabase 세션 토큰을 `Authorization: Bearer ...` 헤더로 보내고, 백엔드는 이를 Supabase `/auth/v1/user`로 검증합니다(`/health` 제외 모든 엔드포인트).
- **데이터 소유권** — 모든 테이블은 Supabase Row Level Security로 `auth.uid()` 기준 사용자별 격리됩니다.

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| Frontend | React 19, React Router 7, TypeScript 5.9, Vite 8, Tailwind CSS 4, react-markdown + remark-gfm |
| 문서/PDF | pdfjs-dist(페이지 수 계산), jspdf + html2canvas(요약 PDF 내보내기) |
| Backend | FastAPI, Uvicorn, LangGraph + LangChain(OpenAI/Gemini), MarkItDown, PyMuPDF, Pillow + pytesseract |
| 인프라 | Supabase(Auth/Postgres/Storage), Vercel(프론트 배포) |

## 사전 준비

- **Node.js** 20.19+ (Vite 8 요구 사항) / npm
- **Python** 3.10+ (개발 환경은 3.12 기준)
- **Supabase 프로젝트** (URL, anon key)
- **OpenAI** 그리고/또는 **Google Gemini** API 키
- **백엔드 외부 도구**
  - [LibreOffice](https://www.libreoffice.org/) — PPT/PPTX 미리보기를 PDF로 변환(`soffice`)
  - [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) + 한국어/영어 언어 데이터 — 이미지 `/convert` OCR
  - (선택) **Google Vision API** 키 — 고품질 이미지 OCR(`/vision/ocr`)

## 프로젝트 구조

```
tongkk/
├─ src/                  # React 프론트엔드
│  ├─ pages/             # 라우트별 페이지 (Dashboard, Calendar, Summary, Quiz, ReviewNotes, Stats, MyPage, Auth)
│  ├─ components/        # 공용 컴포넌트 (AITutorDrawer, MindmapView, PlannerModals)
│  ├─ services/          # Supabase·백엔드 호출 및 도메인 로직
│  ├─ AuthContext.tsx    # 로그인 세션 컨텍스트
│  ├─ CourseContext.tsx  # 과목 선택 컨텍스트
│  ├─ ToastContext.tsx   # 토스트 알림 컨텍스트
│  ├─ App.tsx            # 라우팅
│  └─ main.tsx           # 진입점
├─ server/               # FastAPI 백엔드 (AI 처리)
│  ├─ main.py            # API 엔드포인트 / 문서 변환 / 요약·퀴즈·채점·계획
│  ├─ agent.py           # LangGraph 학습 에이전트(AI 튜터)
│  └─ requirements.txt
├─ supabase/
│  └─ schema.sql         # 테이블 · RLS · 스토리지 버킷 정의
├─ public/               # 정적 파일
├─ vite.config.ts        # 개발 프록시(/api → :8000)
├─ vercel.json           # 운영 배포 (SPA fallback + /api 리라이트)
└─ package.json
```

## 시작하기

### 1. Supabase 설정

Supabase 대시보드 → **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다.
테이블, RLS 정책, 그리고 스토리지 버킷(`avatars` 공개 / `course-materials` 비공개)이 생성됩니다.

이미 운영 중인 DB에는 전체 초기 스키마 대신 새 마이그레이션 [`202611220001_learning_sessions.sql`](supabase/migrations/202611220001_learning_sessions.sql)을 한 번 적용합니다. 기존 `courses`·`materials` 구조를 기준으로 신규 세션 테이블 5개와 서버 전용 함수를 추가합니다.

### 2. 백엔드 (FastAPI)

```bash
cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # 키 입력
uvicorn main:app --reload
```

기본 주소는 `http://localhost:8000`입니다. `GET /health`로 동작을 확인할 수 있습니다.

> PPT 미리보기에는 LibreOffice가, 이미지 `/convert` OCR에는 Tesseract가 시스템에 설치돼 있어야 합니다.

### 3. 프론트엔드 (React)

```bash
npm install
cp .env.example .env.local         # 키 입력
npm run dev
```

기본 주소는 `http://localhost:5173`입니다.

개발용 `.env.local`은 `VITE_API_URL=/api`로 두고 프론트·백엔드를 함께 실행합니다. Vite가 `/api` 요청을 `127.0.0.1:8000`으로 전달하므로 개발 포트가 바뀌어도 별도의 CORS 설정 없이 연결됩니다.

### 4. macOS 메뉴바 앱

Rust 1.90 이상과 Xcode Command Line Tools가 필요합니다. 프로젝트 루트에서 실행합니다.

```bash
npm run menubar:dev
```

Tauri가 웹 개발 서버를 5173 포트에서 함께 실행합니다. 이미 5173 포트에서 개발 서버를 실행 중이면 먼저 종료합니다. 다른 포트로 자동 이동하지 않도록 고정해 앱과 서버 주소가 어긋나는 것을 방지합니다. 설정 방식은 [Tauri 개발 문서](https://v2.tauri.app/develop/)를 따릅니다.

메뉴바 아이콘을 누르면 팝오버가 열립니다. 자료를 선택하고 질문하면 튜터 화면으로 이동하며, 뒤로가기 또는 Esc로 팝오버에 돌아옵니다. 튜터에서 선택 목록이 열려 있으면 Esc는 목록과 선택 패널을 먼저 닫은 뒤 팝오버로 돌아갑니다. 창 밖을 클릭하면 앱 창이 숨겨집니다.

```bash
npm run menubar:build
```

배포용 앱과 DMG는 `src-tauri/target/release/bundle/`에 생성됩니다. **배포용 앱은 `https://tongkk.com/mini`를 불러옵니다.** 로컬 웹 수정은 개발 모드에서 확인하고, 배포용 앱에 반영하려면 웹 배포를 별도로 진행해야 합니다. 앱·브라우저의 로그인 세션은 공유되지 않습니다. AI 답변까지 확인할 때는 백엔드도 실행해야 합니다.

### 학습 세션

자료 상세의 **직접 설명하며 학습하기**, 대시보드의 **기억에서 꺼내는 학습**, 또는 `/learn`에서 시작합니다. 자료 하나에서 기본 2개 개념을 선택해 회상 → 근거 피드백 → 원문·힌트 → 객관식 기초 확인 → 결과 순서로 진행하며, `/learn/:sessionId`에서 저장된 학습을 재개합니다.

서버에 `SUPABASE_SECRET_KEY`(또는 구형 `SUPABASE_SERVICE_ROLE_KEY`)를 설정하고 위 마이그레이션을 적용해야 합니다. 키가 없으면 세션 API는 설정 안내와 503을 반환합니다. 서버 키를 `VITE_` 변수나 브라우저에 넣지 않습니다. 원문은 사용자 JWT/RLS로 읽고, 신규 세션 데이터는 서버 전용 RPC로 저장합니다. Supabase의 `service_role`에는 기존 `courses`·`materials` 조회 및 행 잠금에 필요한 권한도 있어야 합니다.

준비와 자기 설명 평가에는 OpenAI를 사용합니다. `LEARNING_SESSION_MODEL`로 모델을 지정하며, 미설정 시 `OPENAI_MODEL`을 사용합니다. 기본 2개 개념은 정상 3회, 실패 복구 포함 최대 4회의 모델 요청을 허용합니다. 힌트·확인 채점은 추가 모델 호출 없이 처리합니다. 실제 원문·모델의 내용 품질은 파일럿에서 별도 검토해야 합니다.

```bash
npm run test:learning-db             # 임시 메모리 PostgreSQL: 권한·원자성·삭제 검사
cd server
.venv/bin/python -m pytest -q         # 모델·DB 어댑터를 대체한 서버 테스트 포함
```

AI 작업 상태와 실행 lease는 DB에 저장하지만 실행 자체는 FastAPI 프로세스에서 수행합니다. 서버가 재시작되면 만료된 작업을 화면에서 명시적으로 재시도합니다. 영속 큐에 의한 자동 재개는 제공하지 않습니다. `LEARNING_SESSION_ENABLED=false`로 새 세션 시작을 중단해도 기존 기록 조회·진행은 유지됩니다.

### 암기 카드·학습 코스·음성

대시보드와 사이드바에서 **암기 카드**(`/flashcards`), **학습 코스**(`/study-paths`), **강의 녹음**(`/audio`)으로 이동합니다. 자기 설명 화면의 음성 입력은 전사문을 검토·수정한 뒤 답변에 반영하며, 자동으로 채점하지 않습니다.

기존 DB에 이전 마이그레이션이 적용된 상태에서 아래 파일을 순서대로 적용합니다. 신규 설치의 `schema.sql`에는 모두 포함되어 있습니다.

1. [`202611260001_flashcards.sql`](supabase/migrations/202611260001_flashcards.sql)
2. [`202611260002_study_paths.sql`](supabase/migrations/202611260002_study_paths.sql)
3. [`202611260003_study_toolkit_clear.sql`](supabase/migrations/202611260003_study_toolkit_clear.sql)

카드는 수동 작성·오답 저장·AI 초안 편집을 지원합니다. 다시/어려움/알겠음/쉬움 평가에 따라 다음 복습이 10분~365일 범위에서 정해집니다. 평가는 자기 판단이며 개념 숙련도 점수와 별도로 저장합니다. 카드 목록은 한 번에 최대 1,000개를 표시합니다.

코스는 사용자당 최대 30개, 코스당 자료 최대 6개, 원문 합계 60,000자, 최대 12챕터를 지원합니다. 챕터의 원문은 12,000자 이내이며, 각 챕터에서 핵심 개념 2개를 학습합니다. 생략 없이 설명·확인 활동을 수행한 세션만 완료 진도에 반영합니다. 원문이 바뀌면 새 코스를 만들어야 합니다. 코스에는 학습 세션과 동일한 서버 전용 Supabase 키와 OpenAI 설정이 필요합니다.

음성은 마이크 녹음 또는 브라우저에서 해독 가능한 음성 파일을 지원하며 한 번에 10분·20MB까지 처리합니다. 브라우저에서 PCM WAV로 변환하고 서버에서 실제 길이를 검사합니다. 전사에는 서버의 `OPENAI_API_KEY`가 필요하며 모델은 `OPENAI_TRANSCRIPTION_MODEL`(기본 `gpt-4o-mini-transcribe`)로 설정합니다. 원본 음성은 학습 자료로 저장하지 않고, 사용자가 확인한 전사 텍스트만 저장합니다. 마이크는 HTTPS 또는 localhost에서 사용할 수 있습니다.

```bash
npm run test:flashcards-db
npm run test:study-paths-db
npm run test:workflow-db
```

## 환경 변수

### 프론트엔드 (`.env.local`)

| 변수 | 설명 |
| --- | --- |
| `VITE_API_URL` | FastAPI 서버 주소. 미설정 시 `VITE_BACKEND_URL` → `/api` 프록시 순으로 폴백 |
| `VITE_SUPABASE_URL` | Supabase Project URL (`https://...supabase.co`, `/rest/v1` 없이) |
| `VITE_SUPABASE_ANON_KEY` | Supabase `anon public` 키 |

> `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`는 필수입니다(없으면 앱이 시작 시 오류를 던집니다).

### 백엔드 (`server/.env`)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS 허용 프론트엔드 주소 |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | — | 호출자 로그인 토큰 검증용. 운영에서 누락되면 인증 API는 503으로 중단 |
| `SUPABASE_SECRET_KEY` | — | 학습 세션 DB 저장용 서버 키. 구형 `SUPABASE_SERVICE_ROLE_KEY`도 지원 |
| `LEARNING_SESSION_MODEL` | `OPENAI_MODEL` | 학습 세션 준비·자기 설명 평가 모델 |
| `LEARNING_SESSION_ENABLED` | `true` | `false`이면 새 세션 생성 중단 |
| `LOGIN_MAX_FAILURES` | `5` | 계정별 연속 로그인 실패 허용 횟수 |
| `LOGIN_LOCK_SECONDS` | `900` | 실패 한도 도달 후 로그인 잠금 시간(초) |
| `LOGIN_ATTEMPTS_DB_PATH` | `server/login_attempts.sqlite3` | 로그인 실패 상태 SQLite 경로(운영에서는 영속 볼륨 권장) |
| `LOGIN_FORWARD_CLIENT_IP` | `false` | Supabase 로그인 제한에 사용자별 IP 전달. 아래 인증 배포 설정 필요 |
| `OPENAI_API_KEY` | — | GPT 요약/튜터/퀴즈/채점/학습 계획 |
| `OPENAI_MODEL` | `gpt-5.4-mini` | OpenAI 모델명 |
| `OPENAI_MAX_TOKENS` | `8192` | OpenAI 출력 토큰 한도 |
| `GEMINI_API_KEY` | — | Gemini 요약/튜터/퀴즈/채점 |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite-preview` | Gemini 모델명 |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Gemini 출력 토큰 한도 |
| `GOOGLE_VISION_API_KEY` | — | `/vision/ocr` 이미지 OCR |
| `MAX_IMAGE_PIXELS` | `40000000` | 업로드 이미지 최대 픽셀 수(압축 폭탄 방어) |
| `SUMMARY_MAX_TOKENS` | `32768` | 요약 출력 토큰 한도(장문 자료 대응) |
| `VISUAL_ANALYSIS_MODE` | `auto` | `auto`/`always`/`off` — 자료 이미지 비전 분석 여부 |
| `VISUAL_ANALYSIS_MODEL` | `GPT` | 비전 분석에 쓸 모델(`GPT`/`Gemini`) |
| `VISUAL_ANALYSIS_MAX_ITEMS` | `12` | 분석할 최대 페이지/이미지 수 |
| `VISUAL_ANALYSIS_BATCH_SIZE` | `4` | 비전 분석 배치 크기 |
| `VISUAL_ANALYSIS_MIN_TEXT_CHARS` | `1200` | PPTX 비전 분석 트리거 텍스트 길이 임계값 |
| `PDF_VISUAL_RENDER_DPI` | `90` | PDF 페이지 렌더링 DPI |
| `PDF_VISUAL_TEXT_PAGE_CHARS` | `180` | 비전 분석 대상 PDF 페이지 판단 임계값 |
| `TESSERACT_LANG` | `kor+eng` | 이미지 OCR 언어 |
| `LIBREOFFICE_PATH` | (자동 탐색) | LibreOffice 실행 파일 경로 |
| `PPT_PREVIEW_TIMEOUT_SECONDS` | `120` | PPT→PDF 변환 타임아웃 |

### 인증 배포 설정

- Supabase **Authentication → URL Configuration**에서 Site URL을 운영 프론트엔드 주소로 지정하고, Redirect URLs에 운영 주소의 `/auth`, `/auth/reset-password`를 추가한다. 개발 주소도 실제 사용하는 호스트·포트별로 추가한다(예: `http://127.0.0.1:5175/auth/reset-password`).
- 새 재설정 메일은 `/auth/reset-password`로 돌아온다. 기존 `/auth` 또는 `/` 복구 링크도 전용 화면으로 이동한다. 복구 세션이 유효하면 새로고침 후에도 비밀번호 폼을 유지한다. 만료 링크는 안내 화면에서 메일을 다시 요청할 수 있다.
- Confirm email이 켜져 있으면 가입 후 인증 안내와 재전송을 제공하고, 꺼져 있으면 즉시 로그인한다. 메일 발송 요청은 같은 종류·이메일에 대해 중복 실행과 60초 이내 재전송을 막는다. 실제 발송 여부·제한은 Supabase Auth/SMTP 설정을 따른다.
- 백엔드의 로그인 횟수 제한은 비밀번호 불일치(`invalid_credentials`)만 집계한다. 이메일 미인증·인증 서버 오류·메일/요청 제한은 비밀번호 실패로 집계하지 않는다.

백엔드 경유 로그인이 서버 한 대의 IP 제한을 공유하지 않도록 하려면 다음 설정을 **모두** 완료한 뒤 `LOGIN_FORWARD_CLIENT_IP=true`로 둔다.

1. Supabase Auth에서 IP 전달(`security_sb_forwarded_for_enabled`)을 활성화한다.
2. `server/.env`의 `SUPABASE_SECRET_KEY`에 해당 프로젝트의 서버 secret 키를 설정한다. 브라우저 환경변수에 넣지 않는다.
3. Uvicorn의 `--proxy-headers --forwarded-allow-ips`에 실제 신뢰할 프록시 주소만 지정한다. 예: 같은 서버의 프록시라면 `--forwarded-allow-ips=127.0.0.1`. 외부에서 백엔드로 직접 전달 헤더를 위조할 수 없도록 접근 경로도 제한한다. `*`로 모든 발신자를 신뢰하지 않는다.

서버는 ASGI `request.client`만 사용하며 브라우저가 보낸 `X-Forwarded-For`나 `CF-Connecting-IP`를 직접 신뢰하지 않는다. IP 전달 기능은 기본적으로 꺼져 있고, 활성화했을 때 서버 키/IP가 누락되면 오류로 중단한다. [Supabase IP 전달 문서](https://supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding)

## API 엔드포인트

`/health`와 `/auth/login`을 제외한 모든 엔드포인트는 Supabase 로그인 토큰(`Authorization: Bearer`)을 요구합니다.

> `/auth/login`은 계정별 실패를 서버에서 기록해 기본 5회 실패 시 15분간 잠급니다. Supabase의 공개 Auth API 자체도 보호하도록 운영 프로젝트의 **Authentication → Rate Limits**와 CAPTCHA를 함께 설정해야 합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 서버 상태 확인 |
| `POST` | `/auth/login` | 비밀번호 로그인(실패 횟수 제한 후 Supabase Auth 위임) |
| `POST` | `/convert` | PDF·PPT/PPTX·이미지 → Markdown (텍스트 추출 + 비전 분석/OCR) |
| `POST` | `/preview/pdf` | PDF·PPT/PPTX → PDF 미리보기 바이트(PPT는 LibreOffice 변환) |
| `POST` | `/vision/ocr` | 이미지 → Google Vision 텍스트 |
| `POST` | `/summarize` | Markdown + 템플릿 → 요약(`result`) |
| `POST` | `/agent` | 대화 메시지 → AI 튜터 응답(멀티턴, `thread_id`) |
| `POST` | `/quiz` | 과목/난이도/유형 + 자료 → 퀴즈 JSON |
| `POST` | `/quiz/grade-subjective` | 주관식 답안 채점(점수·피드백) |
| `POST` | `/study-plan` | D-day·미완료 항목 → 오늘 할 일 |

## 데이터 모델 (Supabase)

모든 테이블은 RLS로 사용자별 격리됩니다.

| 테이블 | 용도 |
| --- | --- |
| `courses` | 과목 |
| `materials` | 과목별 강의자료(추출된 Markdown 포함) |
| `summaries` | 자료 기반 요약(4종 템플릿) |
| `summary_chat_sessions` / `summary_chat_messages` | AI 튜터 대화 세션·메시지 |
| `quiz_sets` | 생성된 퀴즈 세트 |
| `quiz_attempts` | 퀴즈 풀이 기록(점수·취약 주제·소요 시간) |
| `dashboard_state` | D-day·할 일·페이스 등 대시보드 상태(JSON) |
| `profiles` | 닉네임·아바타·다크 모드·알림 설정 |

스토리지 버킷: `avatars`(공개), `course-materials`(비공개).

## 배포

- **프론트엔드** — Vercel. `vercel.json`이 SPA 라우팅 폴백과 `/api/*` → 백엔드 서버 리라이트를 처리합니다.
- **백엔드** — FastAPI 서버(예: AWS). Cloudflare 터널을 쓰는 경우 `*.trycloudflare.com` 출처가 CORS·Vite `allowedHosts`에 허용돼 있습니다.

## 개발 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | Vite 개발 서버 |
| `npm run build` | 프로덕션 빌드(`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | ESLint 검사 |
