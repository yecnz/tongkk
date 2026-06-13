// 튜토리얼 '본 적 있음' 기록을 기기 로컬에 저장하는 단일 게이트.
// 화면별 키 + 콘텐츠 버전을 단일 묶음 키에 모아 둔다(예: {"dashboard":1,"summary-upload":1}).
// 서버/계정 동기화는 1차 범위 외 — UI 사용법 안내라 기기/브라우저에 묶이는 게 자연스럽고,
// 게스트도 동작해야 하며, 매 진입 서버 왕복으로 트리거가 지연되는 걸 피한다.
// 모든 접근은 try/catch로 감싸 프라이버시 모드 등 저장 불가 환경에선 '매번 노출'로 폴백한다.

const STORAGE_KEY = "tongkk-tutorial-seen";

export type TutorialSeenMap = Record<string, number>;

function readSeen(): TutorialSeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as TutorialSeenMap;
    return {};
  } catch {
    return {};
  }
}

function writeSeen(map: TutorialSeenMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 저장 불가 환경(프라이버시 모드 등) — 무시하고 다음 진입에 다시 노출되도록 둔다.
  }
}

/** 저장된 버전이 현재 버전 이상이면 '봤다'고 판단한다(콘텐츠 버전이 오르면 다시 노출). */
export function hasSeenTutorial(key: string, version: number): boolean {
  const seen = readSeen()[key];
  return typeof seen === "number" && seen >= version;
}

/** 사용자가 닫는 시점에만 호출한다(StrictMode 이중 마운트에도 안전). 저장값은 max로 갱신. */
export function markTutorialSeen(key: string, version: number): void {
  const map = readSeen();
  const current = map[key];
  map[key] = typeof current === "number" ? Math.max(current, version) : version;
  writeSeen(map);
}

/** 마이페이지 '모든 튜토리얼 다시 보기' — 다음 각 화면 첫 진입 때 다시 뜨게 한다. */
export function resetAllTutorials(): void {
  writeSeen({});
}
