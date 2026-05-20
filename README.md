# Tongkk

## Backend

FastAPI 서버는 강의자료 변환, 요약, 에이전트, 퀴즈 생성 API만 제공합니다.
사용자 인증과 데이터 저장은 Supabase Auth/DB가 담당합니다.

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

기본 서버 주소는 `http://localhost:8000`입니다.

### API

- `GET /health`
- `POST /convert`
- `POST /summarize`
- `POST /agent`
- `POST /quiz`

### Environment

`server/.env.example`을 `server/.env`로 복사한 뒤 필요한 키를 채웁니다.

- `FRONTEND_ORIGIN`: CORS 허용 프론트엔드 주소
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: FastAPI API 호출자의 Supabase 로그인 토큰 검증용 설정
- `OPENAI_API_KEY`, `OPENAI_MODEL`: GPT 요약/에이전트/퀴즈 설정
- `GEMINI_API_KEY`, `GEMINI_MODEL`: Gemini 요약/에이전트/퀴즈 설정

## Frontend

프론트는 Supabase Auth/DB로 로그인과 사용자별 데이터를 관리하고, FastAPI는 AI 처리만 담당합니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Supabase 대시보드의 SQL Editor에서 `supabase/schema.sql`을 실행한 뒤 앱을 사용합니다.

`.env.local`에는 다음 값을 넣습니다.

- `VITE_API_URL`: FastAPI 서버 주소
- `VITE_SUPABASE_URL`: Supabase Project URL (`/rest/v1` 없이 `https://...supabase.co`)
- `VITE_SUPABASE_ANON_KEY`: Supabase `anon public` key

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
