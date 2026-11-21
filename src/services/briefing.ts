import { ddayTypeLabels, formatDdayLabel, type DdayType } from "./studyPlanner";
import type { PaceStatus } from "./pace";

// 대시보드 "오늘의 브리핑": 이미 불러온 데이터만으로 오늘 할 일과 근거 한 줄을 만든다(LLM 없음).
export type BriefingItem = { title: string; reason: string; urgent: boolean };

export type BriefingInput = {
  ddays: { subj: string; type?: DdayType; daysLeft: number }[];
  paces: { course: string; status: PaceStatus; progress: number; todayTarget: number; unitLabel: string }[];
  // 과목별 퀴즈 점수(최근 응시가 앞).
  scores: Record<string, number[]>;
  todayPlansLeft: number;
};

const UPCOMING_DAYS = 7;
const LOW_SCORE = 70;
const MAX_ITEMS = 4;

export const buildBriefing = ({ ddays, paces, scores, todayPlansLeft }: BriefingInput): BriefingItem[] => {
  const items: BriefingItem[] = [];
  const covered = new Set<string>();
  const latestScore = (course: string) => {
    const score = scores[course]?.[0];
    return score === undefined ? null : Math.round(score);
  };

  ddays
    .filter(dday => dday.daysLeft >= 0 && dday.daysLeft <= UPCOMING_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 2)
    .forEach(dday => {
      const label = ddayTypeLabels[dday.type ?? "assignment"];
      const when = dday.daysLeft === 0 ? "오늘" : `${dday.daysLeft}일 전`;
      const score = latestScore(dday.subj);
      covered.add(dday.subj);
      items.push({
        title: `${dday.subj} ${label} ${formatDdayLabel(dday.daysLeft)}`,
        reason: score === null ? `${label} ${when}` : `${label} ${when} · 최근 정답률 ${score}%`,
        urgent: dday.daysLeft <= 3,
      });
    });

  paces
    .filter(pace => pace.status !== "on" && !covered.has(pace.course))
    .slice(0, 2)
    .forEach(pace => {
      covered.add(pace.course);
      items.push({
        title: `${pace.course} 진도 따라잡기`,
        reason: `진도 ${pace.progress}% · 오늘 ${pace.todayTarget}${pace.unitLabel}`,
        urgent: pace.status === "behind",
      });
    });

  Object.keys(scores)
    .map(course => ({ course, score: latestScore(course) }))
    .filter((entry): entry is { course: string; score: number } =>
      entry.score !== null && entry.score < LOW_SCORE && !covered.has(entry.course))
    .sort((a, b) => a.score - b.score)
    .slice(0, 1)
    .forEach(({ course, score }) => {
      items.push({ title: `${course} 오답 복습`, reason: `최근 퀴즈 정답률 ${score}%`, urgent: false });
    });

  if (todayPlansLeft > 0) {
    items.push({ title: `오늘 계획 ${todayPlansLeft}개 남음`, reason: "학습 캘린더에서 정한 할 일", urgent: false });
  }

  return items.slice(0, MAX_ITEMS);
};
