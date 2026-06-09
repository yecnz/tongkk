import { PINK, CYAN } from "../common";
import type { CourseMaterial } from "./materials";
import type { SavedQuizSet } from "./quizSets";

// 학습 캘린더/대시보드가 공유하는 D-day·학습계획·페이스 관련 타입과 순수 헬퍼.
// (컴포넌트가 없으므로 react-refresh 규칙에 안전한 .ts 모듈)

// D-day 종류. 저장된 레거시 데이터에 type이 없으면 assignment로 간주(하위호환).
export type DdayType = "assignment" | "event" | "exam";
export const ddayTypeLabels: Record<DdayType, string> = { assignment: "과제", event: "일정", exam: "시험" };
// 타입별 색(과제=핑크, 일정=청록, 시험=보라). soft=배경, solid=글자/포인트.
export const ddayTypeColors: Record<DdayType, { solid: string; soft: string }> = {
  assignment: { solid: PINK, soft: "var(--color-tint-pink)" },
  event: { solid: CYAN, soft: "var(--color-tint-cyan)" },
  exam: { solid: "var(--color-violet)", soft: "var(--color-tint-violet)" },
};

export type Dday = { id?: string; type?: DdayType; subj: string; date: string };
export type Plan = {
  id?: string;
  text: string;
  done: boolean;
  minutes?: number;
  sourceType?: DdayType | "carryover";
  date?: string; // "YYYY-MM-DD". 없으면 "오늘"로 간주(하위호환).
};

export type PaceBasis = "pages" | "quiz" | "materials" | "manual";

export type CourseContentMetrics = {
  materialCount: number;
  pageUnits: number;
  pageUnitLabel: "페이지" | "슬라이드";
  quizQuestions: number;
};
export const emptyMetrics: CourseContentMetrics = { materialCount: 0, pageUnits: 0, pageUnitLabel: "페이지", quizQuestions: 0 };

// D-day를 연결하지 않은 플랜의 기본 기간(일). 남은 분량을 이 기간에 나눠 꾸준히 진행하는 페이스로 계산한다.
export const PACE_NO_DDAY_HORIZON_DAYS = 14;

export const createClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// 오늘 자정 기준 D-day 남은 일수. 양수=남음, 0=당일, 음수=지남.
export const getDaysLeft = (dateStr: string) => {
  const target = new Date(dateStr);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
};

export const formatDdayLabel = (daysLeft: number) =>
  daysLeft > 0 ? `D-${daysLeft}` : daysLeft === 0 ? "D-Day" : `D+${Math.abs(daysLeft)}`;

// 과목이 이미 보유한 실제 콘텐츠에서 "분량" 후보들을 뽑는다(페이지 합계 우선, 없으면 슬라이드 / 퀴즈 문항 / 자료 개수).
export const computeCourseMetrics = (materials: CourseMaterial[], quizSets: SavedQuizSet[]): CourseContentMetrics => {
  const pageSum = materials.reduce((sum, material) => sum + (material.pages ?? 0), 0);
  const slideSum = materials.reduce((sum, material) => sum + (material.slides ?? 0), 0);
  const usePages = pageSum > 0;
  return {
    materialCount: materials.length,
    pageUnits: usePages ? pageSum : slideSum,
    pageUnitLabel: usePages ? "페이지" : "슬라이드",
    quizQuestions: quizSets.reduce((sum, quizSet) => sum + (quizSet.count ?? 0), 0),
  };
};
