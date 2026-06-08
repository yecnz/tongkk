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
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | — | 호출자 로그인 토큰 검증용 (둘 다 비우면 인증 비활성화) |
| `OPENAI_API_KEY` | — | GPT 요약/튜터/퀴즈/채점/학습 계획 |
| `OPENAI_MODEL` | `gpt-5.4-mini` | OpenAI 모델명 |
| `OPENAI_MAX_TOKENS` | `8192` | OpenAI 출력 토큰 한도 |
| `GEMINI_API_KEY` | — | Gemini 요약/튜터/퀴즈/채점 |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite-preview` | Gemini 모델명 |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Gemini 출력 토큰 한도 |
| `GOOGLE_VISION_API_KEY` | — | `/vision/ocr` 이미지 OCR |
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

## API 엔드포인트

`/health`를 제외한 모든 엔드포인트는 Supabase 로그인 토큰(`Authorization: Bearer`)을 요구합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 서버 상태 확인 |
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
