# 통크크 홍보 페이지

서비스 앱과 독립된 정적 페이지입니다. 이 폴더 전체를 정적 호스팅에 올리거나 로컬 HTTP 서버로 열면 됩니다. 배포된 파일을 사용하는 데는 빌드, 환경변수, 로그인 설정이 필요하지 않습니다. 기능 예시의 iframe 높이 동기화를 위해 `file://` 대신 HTTP로 미리 봅니다.

## 기존 Vercel 프로젝트 배포

저장소 루트에서 `npm run build`를 실행하면 Vite 앱 빌드 후 `scripts/copy-promo.mjs`가 배포용 HTML·CSS·JS·라이선스·assets를 `dist/promo/`로 복사합니다. 소스·테스트·빌드 스크립트는 공개하지 않습니다. 체험 번들은 아래 갱신 절차로 먼저 재생성한 저장본을 사용합니다.

`vercel.json`은 빌드 명령을 `npm run build`, 출력 폴더를 `dist`로 지정합니다. `/promo`는 `/promo/`로 영구 이동하고, `/promo/`는 `promo/index.html`, 하위 파일은 원래 상대경로대로 제공합니다. 이 규칙은 앱의 SPA 폴백보다 먼저 적용되며 `/api/*` 프록시는 유지합니다.

기능 예시 iframe인 `/promo/features.html`에만 `X-Frame-Options: SAMEORIGIN`을 적용합니다. 나머지 경로는 기존 `DENY`를 유지합니다. 새 프로젝트나 도메인은 필요하지 않으며 GitHub `main` 배포 완료 후 https://tongkk.com/promo/ 에서 확인합니다.

## 실제 화면 UI

- 창 헤더·원본/요약/퀴즈 탭·하단 버튼: `src/components/SampleDemo.tsx`의 크기, 색상, 간격을 적용했습니다.
- 원본과 네 가지 요약: `src/sampleDemoContent.ts`의 내용을 그대로 사용하고 `SampleDemo.tsx`의 실제 Markdown·KaTeX 렌더러를 빌드에 포함합니다.
- 마인드맵: 실제 `src/components/MindmapView.tsx` 컴포넌트를 사용합니다. 일반 휠은 페이지 스크롤로 이어지고 Ctrl/⌘+휠 또는 확대·축소 버튼으로 배율을 바꿉니다.
- 퀴즈: `src/pages/Quiz.tsx`의 보기 버튼, 클릭 즉시 채점, 정답·오답 색, 해설, 문항 이동과 결과 표시 스타일을 따릅니다. 공개 예시의 객관식 2문항과 OX 1문항을 직접 풀고 다시 풀 수 있습니다.
- 튜터: `src/components/AITutorDrawer.tsx`의 대화창 스타일과 실제 `FormattedTutorText`를 사용합니다. 준비된 다섯 주제의 답변, 추천·후속 질문, 직접 입력, 새 대화를 체험할 수 있습니다. 지원하지 않는 질문은 예시 범위를 안내합니다.
- 글꼴: 실제 앱과 같은 Pretendard Variable v1.3.9를 로컬 파일로 포함했습니다. 폰트 라이선스는 `assets/fonts/OFL.txt`에 있습니다.

직접 조작하는 예시에는 서버나 AI 호출이 없습니다. 답변과 점수는 현재 페이지 안에서만 유지되며 새로고침하면 초기화됩니다. ‘내 자료로 시작하기’와 ‘로그인’은 통크크 서비스로 이동합니다.

## 파일과 갱신

- `index.html`, `styles.css`, `script.js`: 독립 홍보 페이지와 실제 UI를 감싸는 창, 전체 스크롤, 메뉴
- `demo-source.tsx`, `demo-source.css`: 체험 연결 코드와 실제 앱에서 옮긴 UI 스타일
- `tutor-demo.tsx`, `tutor-demo.css`, `tutor-samples.ts`: 실제 UI에 맞춘 로컬 튜터 체험과 준비된 답변
- `build-demo.mjs`: 실제 앱의 샘플 데이터·렌더러를 읽어 독립 브라우저 파일로 생성
- `demo.js`, `demo.css`: 생성된 배포 파일. React·Markdown·KaTeX와 수식 글꼴을 포함해 외부 CDN에 의존하지 않습니다.
- `test-demo.mjs`: 요약 전환, 마인드맵, 퀴즈 채점·복습·재시도 검증
- `test-flow.mjs`: 네 단계 링크, 키보드 탭, 퀴즈→튜터→다시 풀기와 대화 입력 검증
- `features.html`, `features-source.tsx`, `features-source.css`: 기능별 실제 앱 UI를 격리한 인라인 예시와 라우팅
- `feature-demo/`: 인증·강의·자료·학습·계획·연동의 메모리 기반 예시 서비스. 실제 API·인증 정보를 사용하지 않습니다.
- `build-features.mjs`, `features.js`, `features.css`: 실제 앱 컴포넌트와 스타일을 읽어 생성하는 기능 예시 번들
- `test-features.mjs`: 9개 실제 UI 화면, 카드·학습 이슈·계획·통계·연동·메뉴바 조작 및 외부 요청 0건 검증
- `features-third-party-notices.txt`, `assets/features/`: 기능 번들 라이선스와 공유 이미지·글꼴. 글꼴의 중복 삽입을 제거하고 필요한 문자 범위만 로드합니다.
- `third-party-notices.txt`: 번들에 포함된 라이브러리의 라이선스
- `assets/`: 기존 브랜드 이미지와 글꼴

체험 소스나 실제 앱의 샘플/렌더러가 바뀌면 저장소 루트에서 기존 프로젝트 의존성을 사용해 재생성합니다.

```sh
node promo/build-demo.mjs
node promo/test-demo.mjs
node promo/test-flow.mjs
node promo/build-features.mjs
node promo/test-features.mjs
```

빌드 과정은 서비스 앱 파일을 수정하지 않습니다. 생성 파일만 수정하면 다음 빌드에서 덮어써지므로 `demo-source.*` 또는 해당 앱 소스를 기준으로 갱신하세요. 기능 예시의 선택 메뉴도 앱의 공통 `CustomSelect`를 재사용합니다.

## 스크롤

학습 흐름 → 기능 소개 → 자주 묻는 질문은 일반 문서 스크롤로 이어집니다. HTML의 세로 overflow는 auto로 유지합니다. body에 양축 `overflow: clip` 또는 `hidden`을 넣으면 뷰포트로 전파돼 휠 스크롤을 막을 수 있으므로 사용하지 않습니다.

긴 예시 자료는 창 내부에서 읽고 끝에서 페이지 스크롤로 이어집니다. 메뉴는 각 구역으로 이동하며 현재 위치를 표시합니다. 원본/요약/퀴즈/튜터 탭과 요약 유형 탭은 방향키·Home·End를 지원합니다. 운영체제의 동작 줄이기 설정에서는 전환 애니메이션을 생략합니다.

## 이해로 이어지는 네 단계

기능 소개는 요약으로 연결 → 퀴즈로 발견 → 튜터에게 질문 → 다시 풀어 확인하는 순서입니다. 각 단계의 상세 기능을 기본으로 펼쳐 보여주고 체험 가능한 화면으로 바로 연결합니다. 실제 서비스의 생성·첨부·저장 기능과 이 페이지의 로컬 예시 범위를 구분합니다.

퀴즈를 채점한 뒤 튜터에게 해당 개념을 질문할 수 있습니다. 단순한 탭 이동은 답과 대화를 유지하고, 명시적인 다시 풀기만 퀴즈 답안을 초기화합니다. 튜터 질문은 외부로 전송되지 않습니다.

## 추가 기능 소개

`#more-features`는 이해·복습, 흐름·계획, 기록·연결로 묶인 9개 기능을 선택하는 갤러리입니다. 첫 설명 학습 예시는 바로 표시하고, 다른 기능을 고르면 같은 자리에서 설명과 실제 앱 UI가 바뀝니다. 세 구역의 패널은 같은 흰색 배경과 테두리를 사용합니다. 기능을 처음 선택할 때 iframe을 로드하고 이후에는 유지하므로 다른 기능을 보고 돌아와도 입력과 체험 상태가 남습니다. 내용 높이를 동기화하여 문서 스크롤을 유지하며, 초기화 버튼은 해당 예시만 다시 시작합니다.

앞의 요약→퀴즈→튜터→재확인 설명도 단계 선택 탭으로 한 번에 하나씩 보여줍니다. 두 선택 영역은 방향키·Home·End를 지원하며, 숨겨진 패널은 키보드와 스크린리더 접근에서 제외합니다. 직접 패널 주소와 기존 구역 주소도 선택 상태에 연결됩니다. 홍보용 학습 통계에서는 학습과 기억 유지·AI 사용량 패널을 제외하고 점수·추이·과목별 성과·개념 기록과 지도를 보여줍니다.

실제 `LearningSession`, `Flashcards`, `LearningIssues`, `StudyPaths`, `LearningResume`, `Calendar`, `Stats`, `SourceConnections`, `CalendarConnections`, `Mini`, `MiniTutor`, `MenubarSettings`를 재사용합니다. 대시보드의 계획 영역과 튜터 Markdown은 빌드할 때 실제 소스에서 추출하며 원본 경계가 바뀌면 빌드를 실패시킵니다. 서비스만 메모리 어댑터로 바꾸므로 입력·수정·카드 평가·계획·연동 비교가 실제 계정에 반영되지 않습니다. 설명 평가와 튜터 답변은 준비된 예시이며 새 AI 요청을 보내지 않습니다. 네트워크는 CSP와 서비스 별칭으로 차단합니다.

설명 학습의 기준별 평가, 카드의 자기평가, 퀴즈 기록 기반 통계, 외부 자료의 읽기 전용 가져오기, Mac 앱 알림의 실행 조건을 구분합니다. 자료 준비·원문 확인·내보내기·학습 메이트·환경 설정은 하단의 펼침 항목에 정리했습니다.
