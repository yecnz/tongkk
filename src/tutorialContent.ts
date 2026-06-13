// 튜토리얼 콘텐츠 레지스트리 — 로직(TutorialContext)과 분리된 데이터.
// 핵심 흐름(자료 → AI 요약 → 자료 이해 → 퀴즈)만 안내한다. D-day·학습계획·오답·통계·
// 마이페이지·AI 튜터는 진입 시 직관적이라 튜토리얼 대상이 아니다(plan: notes/tutorial-redesign-plan.md).
// 마이크로카피는 한국어·행동 지향, 한 스텝 1~2문장.

export type TutorialKey = "welcome" | "dashboard" | "summary-upload";

export type TutorialStep = {
  title: string;
  body: string;
};

export type TutorialConfig = {
  /** 콘텐츠 버전 — 화면 UI가 크게 바뀌어 다시 안내해야 할 때만 올린다(남발 금지). */
  version: number;
  /** 헤더 '?' 재열람 버튼·aria 라벨에 쓰는 화면 이름 */
  title: string;
  /** 자동 노출 표현: modal=중앙 카드(welcome), sheet=우하단 비강압 시트(기본). */
  placement: "modal" | "sheet";
  /** 로그인 필요 화면 — 게스트에게는 자동 노출하지 않는다(요청 시 '?' 재열람은 가능). */
  requiresAuth?: boolean;
  /** 리다이렉트 가드가 있는 화면 — 페이지가 ready()를 직접 호출할 때만 노출(폴백 타이머 없음). */
  explicitReady?: boolean;
  steps: TutorialStep[];
};

export const TUTORIALS: Record<TutorialKey, TutorialConfig> = {
  welcome: {
    version: 1,
    title: "Tongkk 시작하기",
    placement: "modal",
    steps: [
      {
        title: "Tongkk가 뭐예요?",
        body: "강의 자료(PDF·PPT·이미지·텍스트)를 올리면 AI가 강의 노트·치트시트·마인드맵으로 요약하고, 퀴즈까지 만들어줘요.",
      },
      {
        title: "이렇게 써요",
        body: "① 과목 만들기 → ② 자료 올리기 → ③ AI 요약으로 이해 → ④ 퀴즈로 점검. '자료 요약·퀴즈'는 과목 안에서 열려요.",
      },
    ],
  },
  dashboard: {
    version: 1,
    title: "대시보드",
    placement: "sheet",
    requiresAuth: true,
    steps: [
      {
        title: "여기서 강의를 만들고 자료를 올려요",
        body: "과목을 추가하고 강의자료를 올리면 AI가 요약·퀴즈를 만들 준비를 해요. '추가하고 자료 올리기'를 누르면 바로 업로드로 이어져요.",
      },
    ],
  },
  "summary-upload": {
    version: 1,
    title: "자료 요약",
    placement: "sheet",
    requiresAuth: true,
    explicitReady: true,
    steps: [
      {
        title: "자료를 올려 시작하기",
        body: "PDF·PPT·DOCX·TXT·이미지를 끌어다 놓거나 '파일 선택'으로 올리면 AI가 내용을 읽어요. 파일이 없으면 '텍스트 붙여넣기' 탭에 필기를 붙여넣어도 돼요.",
      },
      {
        title: "요약에 반영할 자료 고르기",
        body: "기본은 가장 최근 자료 1개예요. 행을 눌러 여러 개를 함께 고를 수 있는데, 많이 묶을수록 AI가 내용을 줄여 요약해요. 한 강의에 집중하려면 1개만 두세요.",
      },
      {
        title: "종류를 고르고 생성하기",
        body: "일반 요약·강의 노트·마인드맵·치트시트 중에 골라 '요약 생성하기'를 누르세요. 만드는 동안 다른 화면으로 가도 완료되면 알려드려요.",
      },
    ],
  },
};

// 라우트 첫 진입 시 자동 트리거할 화면 매핑(welcome은 라우트 무관 — 비로그인 첫 방문 시 노출).
// '자료 요약'은 explicitReady라 페이지가 ready()를 부를 때만 뜬다(게스트 리다이렉트 경쟁 방지).
export const ROUTE_TO_TUTORIAL: Record<string, TutorialKey> = {
  "/": "dashboard",
  "/summary": "summary-upload",
};
