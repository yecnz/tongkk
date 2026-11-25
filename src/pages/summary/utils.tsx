import type { ReactNode } from "react";
import type { SummaryTemplate } from "../../services/gpt";
import type { DragAnchor, UploadFailureKind } from "./types";

export const templateLabels: Record<SummaryTemplate, string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

export const suggestedTutorQuestions: Record<SummaryTemplate, string[]> = {
  GENERAL: [
    "이 요약을 처음 듣는 사람 기준으로 쉽게 설명해줘",
    "시험에 나올 핵심 포인트만 5개로 정리해줘",
    "중요 용어를 예시와 함께 설명해줘",
    "헷갈리기 쉬운 개념을 비교해서 설명해줘",
  ],
  LECTURE_NOTE: [
    "이번 강의 흐름을 단계별로 다시 설명해줘",
    "교수님이 시험에 낼 만한 질문을 뽑아줘",
    "핵심 개념 사이의 관계를 설명해줘",
    "내가 복습할 수 있게 질문을 하나씩 내줘",
  ],
  MINDMAP: [
    "마인드맵의 큰 가지별 의미를 설명해줘",
    "가지 사이의 관계를 쉬운 예시로 설명해줘",
    "가장 먼저 외워야 할 개념부터 정리해줘",
    "이 구조로 시험 대비 순서를 짜줘",
  ],
  CHEAT_SHEET: [
    "이 치트시트에서 꼭 외워야 할 것만 골라줘",
    "비슷해서 헷갈리는 항목을 비교해줘",
    "빈칸 문제처럼 나한테 질문해줘",
    "시험 직전 5분 복습 순서를 만들어줘",
  ],
};

export const classifyUploadFailure = (message: string): { kind: UploadFailureKind; label: string; guide: string } => {
  const lower = message.toLowerCase();
  if (message.includes("지원") || lower.includes("unsupported")) {
    return {
      kind: "unsupported",
      label: "지원하지 않는 파일",
      guide: "PDF, PPT/PPTX, DOCX, TXT/MD, 이미지 파일이나 텍스트 붙여넣기로 다시 추가해주세요.",
    };
  }
  if (
    message.includes("너무 큽") || message.includes("10MB") || message.includes("413") ||
    message.includes("50MB") || message.includes("저장 한도") ||
    lower.includes("too large") || lower.includes("maximum allowed size") ||
    lower.includes("exceeded the maximum") || lower.includes("payload too large")
  ) {
    return {
      kind: "tooLarge",
      label: "파일이 너무 큼",
      guide: "파일을 50MB 미만으로 줄이거나 나눠 올리면 원본도 저장됩니다. 지금도 텍스트는 저장돼 요약·퀴즈엔 사용할 수 있어요.",
    };
  }
  if (message.includes("로그인") || message.includes("인증") || message.includes("401") || lower.includes("jwt")) {
    return {
      kind: "auth",
      label: "로그인 만료",
      guide: "다시 로그인한 뒤 같은 파일을 재시도해주세요.",
    };
  }
  if (message.includes("LibreOffice") || message.includes("서버에") || message.includes("설정되지") || lower.includes("converter") || lower.includes("not found")) {
    return {
      kind: "serverTool",
      label: "서버 변환 도구 없음",
      guide: "원본 파일을 보관하고, 가능하면 텍스트 추출 결과나 텍스트 붙여넣기로 이어가세요.",
    };
  }
  if (message.includes("네트워크") || lower.includes("failed to fetch") || lower.includes("network") || message.includes("시간 초과")) {
    return {
      kind: "network",
      label: "네트워크 오류",
      guide: "잠시 후 다시 시도해주세요. 큰 파일이면 페이지 수를 줄이면 성공률이 높아집니다.",
    };
  }
  return {
    kind: "unknown",
    label: "분석 실패",
    guide: "다시 시도하거나 텍스트만 붙여넣어 자료로 추가할 수 있습니다.",
  };
};

// 드래그 앵커를 기준으로 스크롤을 되돌린다.
// - 본문이 살아 있으면(분할 화면 등) 드래그했던 구절을 처음 보던 화면 위치로 맞춘다.
// - 확대 등으로 본문이 언마운트돼 Range가 떨어져 나갔으면, 드래그 당시 스크롤 위치로 근사 복귀한다.
export const restoreScrollToAnchor = (anchor: DragAnchor) => {
  requestAnimationFrame(() => {
    if (anchor.range.startContainer.isConnected) {
      const rect = anchor.range.getBoundingClientRect();
      if (rect.top !== 0 || rect.bottom !== 0) {
        const delta = rect.top - anchor.top;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
        return;
      }
    }
    window.scrollTo({ top: anchor.scrollY });
  });
};

// 요약 내용 렌더: MINDMAP은 JSON을 파싱해 시각화하고, 그 외 템플릿은 마크다운으로 렌더한다.
// 마인드맵 노드 클릭 시 AI 튜터에 넣을 질문. 루트부터의 경로(흐름)와 상위 개념과의 관계를 살린다(루트는 단독 설명).
export const buildMindmapQuestion = (label: string, pathLabels: string[]): string =>
  pathLabels.length > 1
    ? `"${pathLabels.join(" > ")}" 흐름에서 "${label}"의 의미와 상위 개념과의 관계를 설명해줘`
    : `"${label}"에 대해 설명해줘`;

// 요약 종류(4종) 아이콘 — 템플릿 카드와 요약 설정 탭에서 공통으로 쓴다(한 곳만 고치면 둘 다 반영).
export const summaryTypeIcon = (key: SummaryTemplate, size = 20): ReactNode => {
  const c = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
  };
  const icons: Record<SummaryTemplate, ReactNode> = {
    GENERAL: <svg {...c}><path d="M4 6h16M4 10h16M4 14h10M4 18h7" /></svg>,
    LECTURE_NOTE: <svg {...c}><path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M9 3v18" /></svg>,
    MINDMAP: <svg {...c}><circle cx="5" cy="12" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="M7 11l9-4M7 13l9 4" /></svg>,
    CHEAT_SHEET: <svg {...c}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>,
  };
  return icons[key];
};

export const formatHubDate = (timestamp?: number) => {
  if (!timestamp) return "업데이트 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};
