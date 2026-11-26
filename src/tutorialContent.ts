// 튜토리얼 콘텐츠 레지스트리 — 로직(TutorialContext)과 분리된 데이터.
// 핵심 흐름(자료 → AI 요약 → 자료 이해 → 퀴즈)만 안내한다. D-day·학습계획·오답·통계·
// 마이페이지·AI 튜터는 진입 시 직관적이라 튜토리얼 대상이 아니다(plan: notes/tutorial-redesign-plan.md).
// 마이크로카피는 한국어·행동 지향, 한 스텝 1~2문장.

export type TutorialKey = "welcome" | "dashboard" | "summary-upload" | "summary-result" | "quiz-setup" | "quiz-solve";

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
        body: "강의자료로 AI 요약과 퀴즈를 만드세요.",
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
        body: "과목을 추가하고 강의자료를 업로드하세요.",
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
        body: "파일을 업로드하거나 텍스트를 붙여넣으세요.",
      },
      {
        title: "요약에 반영할 자료 고르기",
        body: "최근 자료가 기본 선택됩니다. 여러 자료를 선택하면 내용을 압축해 요약합니다.",
      },
      {
        title: "종류를 고르고 생성하기",
        body: "요약 형식을 선택하고 생성하세요. 다른 화면에서도 완료 알림을 받을 수 있습니다.",
      },
    ],
  },
  // 요약을 막 완성해 자료 상세(요약 탭)에 착지한 순간에만 maybeShow로 1회 노출한다.
  // 라우트 자동 트리거가 아니라 ROUTE_TO_TUTORIAL에는 넣지 않는다(요약 생성 직후에만 의미 있음).
  "summary-result": {
    version: 1,
    title: "만든 요약으로 학습하기",
    placement: "sheet",
    requiresAuth: true,
    steps: [
      {
        title: "만든 요약으로 학습해요",
        body: "탭에서 원본·요약·퀴즈를 확인하세요. 본문을 드래그하면 튜터에게 질문할 수 있습니다.",
      },
      {
        title: "퀴즈로 바로 점검해요",
        body: "퀴즈 탭에서 문제를 생성하고 이해도를 확인하세요.",
      },
    ],
  },
  // 퀴즈 설정·풀이는 라우트(/quiz)가 게스트·과목 미선택을 대시보드로 리다이렉트하고, 진입 방식(설정/
  // 오답 다시 풀기)에 따라 시작 뷰가 달라 라우트 자동 트리거 대신 화면(view)별 maybeShow로 띄운다.
  "quiz-setup": {
    version: 1,
    title: "퀴즈 만들기",
    placement: "sheet",
    requiresAuth: true,
    steps: [
      {
        title: "자료를 올려 퀴즈를 만들어요",
        body: "자료를 업로드하고 퀴즈에 반영할 자료를 선택하세요.",
      },
      {
        title: "시험 모드는 실전처럼",
        body: "켜면 정답·해설이 바로 안 보이고 제한 시간 안에 전체를 풀어요. 시간 버튼은 모드를 켜야 활성화돼요.",
      },
      {
        title: "AI가 자료를 분석해 문제를 만들어요",
        body: "퀴즈를 생성하세요. 이전에 푼 문제는 제외됩니다.",
      },
    ],
  },
  "quiz-solve": {
    version: 1,
    title: "퀴즈 풀이",
    placement: "sheet",
    requiresAuth: true,
    steps: [
      {
        title: "풀이 화면 사용법",
        body: "객관식·OX는 선택 즉시 채점되며 수정할 수 없습니다. 단답형·주관식은 제출 후 채점됩니다. 시험 모드는 종료 후 결과를 확인하세요.",
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
