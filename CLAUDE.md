# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code를 위한 안내서입니다. 제품/설치 문서는 [README.md](README.md)를 참고하세요.

## 프로젝트 개요

Tongkk은 대학 강의자료를 AI로 요약·퀴즈·튜터링·학습 계획까지 도와주는 학습 도우미입니다.

- **Frontend** (`src/`) — React 19 + Vite 8 + TypeScript. 로그인·데이터는 Supabase가 담당.
- **Backend** (`server/`) — FastAPI. 강의자료 변환과 요약/튜터/퀴즈/채점/학습 계획 등 **AI 처리 전용**.
- **DB/Auth/Storage** — Supabase. 스키마는 `supabase/schema.sql`이 단일 출처(source of truth).

## 작업 디렉터리

git 작업이나 파일 변경을 시작할 때는 항상 `pwd`와 `git status`를 먼저 실행해 올바른 저장소인지 확인하세요. 특히 관련 저장소가 여러 개일 때 주의합니다(예: `tongkk` vs `tongkk-langgraph`).

## 코드 위치 가이드

- 라우트/페이지: `src/pages/` (Dashboard, Calendar, Summary, Quiz, ReviewNotes, Stats, MyPage, Auth). 라우팅은 `src/App.tsx`.
- 공용 컴포넌트: `src/components/` (AITutorDrawer, MindmapView, PlannerModals).
- 데이터·API 로직: `src/services/`. Supabase 호출과 백엔드 호출이 모두 여기에 모여 있음.
  - 백엔드 호출의 공통 진입점은 `src/services/backend.ts`의 `BACKEND_URL`/헤더 헬퍼.
  - Supabase 클라이언트와 인증 헤더는 `src/services/supabase.ts`.
- 전역 상태: `src/AuthContext.tsx`(세션), `src/CourseContext.tsx`(과목 선택), `src/ToastContext.tsx`(알림).
- 백엔드 엔드포인트·프롬프트: `server/main.py`. AI 튜터(LangGraph): `server/agent.py`.

## 명령어 & 검증

- 개발: `npm run dev` (프론트), `cd server && uvicorn main:app --reload` (백엔드).
- 변경 후 검증은 **타입 체크 + 린트**로 합니다(이 저장소의 권장 검증 경로):
  - 타입 체크: `npx tsc -b` — `npm run build`(= `vite build`)는 타입 체크를 하지 않으므로 따로 돌립니다.
  - 린트: `npm run lint` (= `eslint .`).
- `npm run build`는 Vite 8 특성상 Node 20.19+ 가 필요합니다. 환경에 따라 빌드가 막히면 위 `tsc -b` + `eslint`로 검증하세요.
- 백엔드를 직접 돌릴 때 PPT 미리보기는 LibreOffice, 이미지 OCR은 Tesseract가 시스템에 설치돼 있어야 합니다.

## 규칙 & 주의사항

- **언어**: UI 문구, 토스트 메시지, LLM 프롬프트는 모두 한국어입니다. 기존 톤을 유지하세요.
- **데이터 격리**: 모든 Supabase 테이블은 RLS로 `auth.uid()` 기준 사용자별 격리됩니다. 데이터 모델을 바꾸면 `supabase/schema.sql`의 테이블·정책을 함께 업데이트하세요.
- **AI는 백엔드에서만**: LLM/OCR 호출은 `server/`에서 처리합니다. 프론트는 `/convert`, `/summarize`, `/agent`, `/quiz`, `/study-plan` 등 백엔드 엔드포인트를 호출합니다.
- **비밀값**: `.env`, `.env.*`(단, `.env.example` 제외), `server/.env`는 커밋하지 않습니다. 키 변경 시 `.env.example`와 README 표만 갱신하세요.
- **요청 라우팅**: 프론트는 `VITE_API_URL`(미설정 시 `/api` 프록시)로 백엔드를 호출합니다. 개발 프록시는 `vite.config.ts`, 운영 리라이트는 `vercel.json`에 정의돼 있습니다.
- **중복 파일 주의**: `"AITutorDrawer 2.tsx"`, `"git-cheatsheet 2.md"`처럼 이름에 ` 2`가 붙은 파일은 동기화로 생긴 사본일 수 있습니다. 실제로 import되는 원본(`AITutorDrawer.tsx` 등)을 수정하세요.
- **커밋/푸시**: 사용자가 요청할 때만 합니다. 기본 브랜치에서는 먼저 브랜치를 만드세요.
