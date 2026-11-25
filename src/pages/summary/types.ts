

export type MaterialDetailTab = "original" | "summary" | "quiz";

export type UploadFailureKind = "unsupported" | "tooLarge" | "serverTool" | "network" | "auth" | "unknown";

// 드래그해서 질문한 본문 구절의 위치 정보. 튜터를 닫을 때 그 자리로 스크롤을 되돌리는 데 쓴다.
// range: 같은 본문이 살아 있을 때 구절 위치 보정용 / scrollY: 확대 등으로 본문이 언마운트돼
// range가 떨어져 나갔을 때 쓰는 드래그 당시 스크롤 위치(근사 복귀용).
export type DragAnchor = { range: Range; top: number; scrollY: number };
