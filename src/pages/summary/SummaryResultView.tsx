import { useState, useRef, useEffect, useLayoutEffect } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { PINK, CYAN, BORDER_COLOR, Card } from "../../common";
import type { SummaryTemplate } from "../../services/gpt";
import { useToast } from "../../ToastContext";
import { MindmapView } from "../../components/MindmapView";
import { parseMindmapJson } from "../../components/mindmapData";
import { AITutorDrawer } from "../../components/AITutorDrawer";
import { SelectionAskButton } from "./SelectionAskButton";
import { FormattedAiText } from "./SummaryContent";
import { collapseForLectureNote, hoistSourceToHeadings, normalizeMarkdownContent, simplifySoleFileSources } from "./markdown";
import type { DragAnchor } from "./types";
import { buildMindmapQuestion, restoreScrollToAnchor, suggestedTutorQuestions, templateLabels } from "./utils";

type SummarySample = { title: string; content: string };

type SummaryResultViewProps = { template: SummaryTemplate; onBack: () => void; backLabel: string; contextTitle: string; realContent: string; sourceMarkdown?: string; sourcePages?: string; isLoading: boolean; error: string; loadingStep: string; elapsedTime: string | null; threadId: string; summaryId: string | null; resetTutorHistory?: boolean; initialTutorQuestion?: string; onGoToQuiz?: () => void; onRetry?: () => void };

const summaryData: Record<SummaryTemplate, SummarySample> = {
  GENERAL: {
    title: "일반 요약",
    content: "핵심 결론\n이 자료는 **동적 프로그래밍**의 개념, 적용 조건, 구현 방식을 설명합니다.\n\n주요 내용\n- **동적 프로그래밍**은 반복되는 하위 문제의 결과를 저장해 재사용합니다.\n- 적용 조건은 **최적 부분 구조**와 **중복 부분 문제**입니다.\n- 구현 방식은 **메모이제이션**과 **타뷸레이션**으로 나뉩니다.\n\n한 줄 요약\n동적 프로그래밍은 중복 계산을 줄여 복잡한 문제를 효율적으로 푸는 방법입니다.",
  },
  LECTURE_NOTE: {
    title: "강의 노트",
    content: "핵심 개념\n**동적 프로그래밍**은 큰 문제를 작은 하위 문제로 나누고, 이미 계산한 결과를 저장해 재사용하는 알고리즘 설계 기법입니다.\n\n주요 내용\n- **최적 부분 구조**: 전체 문제의 최적해가 부분 문제의 최적해로 구성됩니다.\n- **중복 부분 문제**: 같은 하위 문제가 반복해서 등장합니다.\n\n시험 포인트\n1. **메모이제이션**과 **타뷸레이션**의 차이를 구분합니다.\n2. DP가 적용되기 위한 조건을 설명할 수 있어야 합니다.",
  },
  MINDMAP: {
    title: "마인드맵",
    content: "중심 주제\n**동적 프로그래밍**\n\n주요 가지\n- **적용 조건**\n  - 최적 부분 구조\n  - 중복 부분 문제\n- **구현 방식**\n  - 메모이제이션\n  - 타뷸레이션\n- **대표 문제**\n  - 피보나치\n  - 배낭 문제\n  - LCS\n\n핵심 연결\n- 반복 계산을 줄이면 시간 복잡도를 개선할 수 있습니다.",
  },
  CHEAT_SHEET: {
    title: "치트시트",
    content: "빠른 암기표\n- **DP 적용 조건**: 최적 부분 구조, 중복 부분 문제\n- **Top-down**: 재귀 + 메모이제이션\n- **Bottom-up**: 반복문 + 테이블\n\n자주 나오는 비교\n- **메모이제이션**: 필요한 값만 계산, 재귀 호출 사용\n- **타뷸레이션**: 작은 문제부터 순서대로 계산, 반복문 사용\n\n시험 직전 체크\n- DP 조건 2가지를 말할 수 있는가?\n- 대표 문제와 구현 방식을 연결할 수 있는가?",
  },
};

export const SummaryResultView = ({ template, onBack, backLabel, contextTitle, realContent, sourceMarkdown, sourcePages, isLoading, error, loadingStep, elapsedTime, threadId, summaryId, resetTutorHistory = false, initialTutorQuestion, onGoToQuiz, onRetry }: SummaryResultViewProps) => {
  const data = summaryData[template];
  const displayContent = realContent || data.content;
  const mindmapData = template === "MINDMAP" && displayContent ? parseMindmapJson(displayContent) : null;
  const [actionMessage, setActionMessage] = useState("");
  const [mindmapPaneHeight, setMindmapPaneHeight] = useState<number | undefined>(undefined);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [showPrintGuide, setShowPrintGuide] = useState(false);
  const [isTutorOpen, setIsTutorOpen] = useState(Boolean(initialTutorQuestion?.trim()));
  // 확대 시 요약 본문 칸을 숨기고 튜터가 그 영역을 꽉 채운다.
  const [isResultExpanded, setIsResultExpanded] = useState(false);
  const [tutorSelectionQuestion, setTutorSelectionQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  const mindmapPaneRef = useRef<HTMLDivElement | null>(null);
  // 드래그해서 질문한 본문 구절의 위치. 튜터를 닫을 때 그 자리로 스크롤을 되돌린다.
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  // 스트리밍 생성 중 텍스트 끝 지점. 사용자가 하단 근처에 있을 때만 따라 내려간다.
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLoading || !realContent) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
    if (nearBottom) streamEndRef.current?.scrollIntoView({ block: "end" });
  }, [isLoading, realContent]);

  // 완성된 질문을 그대로 튜터 입력창에 채운다(마인드맵 노드 질문 등).
  const askTutorWithQuestion = (question: string, anchor: DragAnchor | null) => {
    dragAnchorRef.current = anchor;
    setIsTutorOpen(true);
    setTutorSelectionQuestion(prev => ({ text: question, nonce: (prev?.nonce ?? 0) + 1 }));
  };
  // 본문 드래그 선택: "다음 내용을 설명해줘" 접두사를 붙인다.
  const askTutorWithSelection = (text: string, anchor: DragAnchor | null) =>
    askTutorWithQuestion(`다음 내용을 설명해줘:\n${text}`, anchor);
  // '쉬운 설명 보기': 더 쉬운 말로 풀어달라는 접두사를 붙인다(이슈 #66).
  const askTutorSimpleWithSelection = (text: string, anchor: DragAnchor | null) =>
    askTutorWithQuestion(`이 내용을 쉽게 설명해줘. :\n${text}`, anchor);

  // 튜터를 닫으면 그리드가 2열→1열로 reflow된다. 드래그했던 구절을 처음 보던 화면 위치로 되돌린다.
  const handleTutorOpenChange = (next: boolean) => {
    setIsTutorOpen(next);
    if (!next) setIsResultExpanded(false); // 닫으면 확대 상태도 해제(본문이 숨겨진 빈 화면 방지).
    if (!next) setTutorSelectionQuestion(null); // 닫으면 대기 중인 선택 질문을 비워 재오픈 시 자동 채움을 막는다.
    const anchor = dragAnchorRef.current;
    if (next || !anchor) return;
    dragAnchorRef.current = null;
    restoreScrollToAnchor(anchor);
  };
  const questions = suggestedTutorQuestions[template];

  // 복사 텍스트도 화면과 동일하게 정제: 본문 인라인 (출처:...)는 제거하고 헤딩 출처만 남긴다.
  const exportContent = template === "MINDMAP"
    ? displayContent
    : collapseForLectureNote(template, simplifySoleFileSources(hoistSourceToHeadings(normalizeMarkdownContent(displayContent))));
  const exportText = `${templateLabels[template]} 요약\n\n${exportContent}`;

  useEffect(() => {
    if (initialTutorQuestion?.trim()) setIsTutorOpen(true);
  }, [initialTutorQuestion]);

  // 마인드맵 칸 높이를 측정해 옆 AI 튜터 높이를 맞춘다(텍스트 요약·확대 시에는 기존 고정 높이 유지).
  const showMindmapTutor = Boolean(mindmapData) && !isResultExpanded && isTutorOpen;
  useLayoutEffect(() => {
    if (!showMindmapTutor) {
      setMindmapPaneHeight(undefined);
      return;
    }
    const el = mindmapPaneRef.current;
    if (!el) return;
    const measure = () => setMindmapPaneHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showMindmapTutor]);

  // 실제 인쇄(→ PDF 저장) 실행. 안내 팝업에서 '계속'을 누르면 호출된다.
  const runPrint = () => {
    setShowPrintGuide(false);
    const prevTitle = document.title;
    document.title = `tongkk-${template.toLowerCase()}-summary`;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    setActionMessage("인쇄 창에서 '대상'을 'PDF로 저장'으로 선택하세요.");
    window.print();
  };

  const handleDownload = async () => {
    if (pdfSaving) return;

    // 텍스트 요약: 브라우저 인쇄로 PDF 저장 (인쇄창 → '대상'을 'PDF로 저장' 선택)
    // 화면 렌더링을 그대로 인쇄하므로 글자 선택이 가능한 텍스트 PDF가 나온다.
    // 바로 인쇄창을 띄우면 사용자가 당황하므로, 먼저 이유를 안내하는 팝업을 보여준다.
    if (!mindmapData) {
      setShowPrintGuide(true);
      return;
    }

    // 마인드맵은 시각화라 인쇄 대신 기존 이미지 캡처(PDF) 방식 유지
    if (!pdfExportRef.current) return;

    setActionMessage("PDF를 생성 중입니다...");
    setPdfSaving(true);

    try {
      await document.fonts.ready;
      const exportNode = pdfExportRef.current;
      if (!exportNode) return;

      // 캡처 전 전체 뷰포트를 흰 막으로 덮어 다른 콘텐츠 유입 차단
      const backdrop = document.createElement("div");
      backdrop.setAttribute("data-pdf-backdrop", "");
      backdrop.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99998;"; // hex-ok: PDF 내보내기 라이트 고정
      document.body.appendChild(backdrop);

      exportNode.style.left = "0px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "99999";
      exportNode.style.letterSpacing = "0.01px";
      void exportNode.getBoundingClientRect();

      const canvas = await html2canvas(exportNode, {
        backgroundColor: "#ffffff", // hex-ok: PDF 내보내기 라이트 고정
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
      });

      document.body.removeChild(backdrop);
      exportNode.style.left = "-10000px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "-1";
      exportNode.style.letterSpacing = "";
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      let heightLeft = imgHeight;
      let y = margin;

      pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
      heightLeft -= contentHeight;

      while (heightLeft > 0) {
        pdf.addPage();
        y -= contentHeight;
        pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
        heightLeft -= contentHeight;
      }

      pdf.save(`tongkk-${template.toLowerCase()}-summary.pdf`);
      setActionMessage("PDF를 다운로드했습니다.");
    } catch {
      document.querySelectorAll<HTMLElement>('[data-pdf-backdrop]').forEach(el => el.remove());
      if (pdfExportRef.current) {
        pdfExportRef.current.style.left = "-10000px";
        pdfExportRef.current.style.zIndex = "-1";
        pdfExportRef.current.style.letterSpacing = "";
      }
      setActionMessage("PDF 다운로드에 실패했습니다.");
    } finally {
      setPdfSaving(false);
    }
  };

  const copySummaryToClipboard = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(exportText);
      return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = exportText;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand("copy");
    textArea.remove();
    if (!copied) throw new Error("Clipboard copy failed");
  };

  const handleCopyAll = async () => {
    setActionMessage("");
    try {
      await copySummaryToClipboard();
      setActionMessage("요약본 전체를 클립보드에 복사했습니다.");
    } catch {
      setActionMessage("전체 복사에 실패했습니다.");
    }
  };

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pdf-print-area, .pdf-print-area * { visibility: visible !important; }
          .pdf-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            z-index: auto !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      {showPrintGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF 저장 안내"
          onClick={() => setShowPrintGuide(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(440px, 100%)", background: "var(--color-card)", borderRadius: 20, padding: "32px 30px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--color-tint-cyan)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>📄</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>PDF로 저장하기</h3>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.8, color: "var(--color-text)", wordBreak: "keep-all" }}>
              <b style={{ color: CYAN }}>계속</b>을 누르면 <b style={{ color: "var(--color-text-strong)" }}>인쇄 창</b>이 열립니다.<br />
              프린터 대신 <b style={{ color: "var(--color-text-strong)" }}>PDF로 저장</b>을 선택하면 돼요.
            </p>
            <div style={{
              margin: "0 0 24px", padding: "16px 16px", borderRadius: 12, background: "var(--color-page)",
              fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)", wordBreak: "keep-all",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ flexShrink: 0 }}>💡</span>
              <span>
                저장된 PDF는 이미지가 아니라 문서 형태라서,<br />
                <b style={{ color: "var(--color-text-strong)" }}>텍스트 선택과 복사</b>가 가능해요.
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowPrintGuide(false)}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >취소</button>
              <button
                type="button"
                onClick={runPrint}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >계속</button>
            </div>
          </div>
        </div>
      )}
      <button type="button" onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>{backLabel}</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{
              padding: "9px 18px", borderRadius: 10, border: "2px solid var(--color-border-soft)",
              background: "var(--color-card)", fontSize: 17, fontWeight: 600, flex: "0 0 auto",
              color: template === "GENERAL" ? "var(--color-text)" : template === "LECTURE_NOTE" ? PINK : template === "MINDMAP" ? CYAN : "var(--color-violet)"
            }}>{templateLabels[template]}</span>
            {isLoading && (
              <span style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 700 }}>
                AI가 요약 중...
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
            {isLoading && (
              <span style={{
                padding: "6px 10px", borderRadius: 999, background: "var(--color-tint-pink)",
                color: PINK, fontSize: 12, fontWeight: 800
              }}>요약 중</span>
            )}
            {!isLoading && elapsedTime && (
              <span style={{
                padding: "6px 10px", borderRadius: 999, background: "var(--color-surface)",
                color: "var(--color-muted)", fontSize: 12, fontWeight: 700
              }}>{elapsedTime}초</span>
            )}
            {!isLoading && (
              <>
                <button type="button" className="tongkk-hover-tint" onClick={handleCopyAll} style={{
                  height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 13, fontWeight: 600, cursor: "pointer"
                }}>전체 복사</button>
                <button type="button" className="tongkk-hover-tint" onClick={handleDownload} disabled={pdfSaving} style={{
                  height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 13, fontWeight: 600,
                  cursor: pdfSaving ? "default" : "pointer",
                  opacity: pdfSaving ? 0.6 : 1,
                }}>{pdfSaving ? "PDF 생성 중" : "PDF 다운로드"}</button>
                <button type="button" className="tongkk-hover-tint" onClick={() => handleTutorOpenChange(!isTutorOpen)} style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border-soft)",
                  background: isTutorOpen ? "var(--color-muted-surface)" : "var(--color-card)",
                  color: isTutorOpen ? "var(--color-text-strong)" : "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}>{isTutorOpen ? "튜터 닫기" : "AI 튜터"}</button>
              </>
            )}
          </div>
        </div>
        {actionMessage && !isLoading && (
          <div style={{ margin: "-6px 0 16px", fontSize: 12, color: "var(--color-muted)", textAlign: "right" }}>
            {actionMessage}
          </div>
        )}
        {!isLoading && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, borderBottom: "1px solid var(--color-border-soft)" }}>
            <button type="button" style={{
              padding: "10px 4px 12px",
              border: "none",
              borderBottom: `2px solid ${PINK}`,
              background: "transparent",
              color: "var(--color-text-strong)",
              fontSize: 14,
              fontWeight: 800,
              cursor: "default",
            }}>요약 결과</button>
            {onGoToQuiz && (
              <button type="button" onClick={onGoToQuiz} style={{
                padding: "10px 4px 12px",
                border: "none",
                borderBottom: "2px solid transparent",
                background: "transparent",
                color: "var(--color-muted)",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}>퀴즈 풀기</button>
            )}
          </div>
        )}

        {!isLoading && !error && (
          <div
            ref={pdfExportRef}
            className="pdf-print-area"
            data-theme="light"
            aria-hidden="true"
            style={{
              position: "fixed",
              left: "-10000px",
              top: 0,
              zIndex: -1,
              width: 794,
              padding: 48,
              background: "#fff", // hex-ok: PDF 내보내기 라이트 고정
              color: "#222", // hex-ok: PDF 내보내기 라이트 고정
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
              fontSize: 14,
              lineHeight: "25px",
              pointerEvents: "none",
            }}
          >
            <h1 style={{
              margin: "0 0 22px",
              paddingBottom: 14,
              borderBottom: "2px solid #f0f0f0", // hex-ok: PDF 내보내기 라이트 고정
              fontSize: 24,
              lineHeight: 1.35,
              color: "#222", // hex-ok: PDF 내보내기 라이트 고정
            }}>
              Tongkk {templateLabels[template]} 요약
            </h1>
            {mindmapData ? (
              <MindmapView key={`pdf-${displayContent}`} data={mindmapData} printMode />
            ) : (
              // 인쇄(PDF)도 화면과 동일하게 보이도록 웹과 같은 렌더러를 사용한다.
              // (이전 PdfFormattedAiText는 출처를 가공하지 않아 문장 끝마다 출처가 노출됐다.)
              <FormattedAiText content={displayContent} template={template} />
            )}
          </div>
        )}

        {isLoading && realContent ? (
          // 스트리밍 생성 중: 지금까지 생성된 텍스트를 그대로 렌더링해 타자기 효과를 낸다.
          <div style={{
            background: "var(--color-card)", borderRadius: 12, padding: 28,
            border: "1px solid var(--color-border-soft)",
            fontSize: 15, color: "var(--color-text)", lineHeight: 1.85,
            overflowX: "auto",
          }}>
            <FormattedAiText content={realContent} template={template} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 13, color: "var(--color-muted)" }}>
              <div style={{
                width: 14, height: 14, flexShrink: 0,
                border: `2px solid ${PINK}`, borderTop: "2px solid transparent",
                borderRadius: "50%", animation: "spin 0.8s linear infinite"
              }}/>
              <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
              {loadingStep || "요약 생성 중..."}
            </div>
            <div ref={streamEndRef} />
          </div>
        ) : isLoading ? (
          <div style={{
            background: "var(--color-surface)", borderRadius: 12, padding: 48,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16
          }}>
            <div style={{
              width: 36, height: 36,
              border: `3px solid ${PINK}`, borderTop: "3px solid transparent",
              borderRadius: "50%", animation: "spin 0.8s linear infinite"
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>
              {loadingStep || "처리 중..."}
            </p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-muted)", opacity: 0.8 }}>
              기다리지 않고 다른 화면으로 이동해도 돼요. 완성되면 알려드릴게요.
            </p>
          </div>
        ) : error ? (
          <div style={{
            background: "var(--color-tint-pink)", borderRadius: 12, padding: 24,
            fontSize: 14, color: "var(--color-danger)", lineHeight: 1.6
          }}>
            <strong>요약 실패:</strong> {error}
            {onRetry && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={onRetry}
                  style={{
                    padding: "9px 18px", borderRadius: 10, border: "none",
                    background: PINK, color: "var(--color-on-brand)", fontSize: 13, fontWeight: 800, cursor: "pointer",
                  }}
                >같은 설정으로 다시 시도</button>
              </div>
            )}
          </div>
        ) : (
          <div className="summary-result-grid" style={{
            display: "grid",
            // 마인드맵일 때는 AI 튜터가 마인드맵과 같은 화면 비율(50:50)을 차지하도록 두 칸을 동일하게,
            // 텍스트 요약일 때는 읽기 폭 유지를 위해 기존처럼 튜터를 고정 400px로 둔다.
            // ~768px에선 .summary-result-grid(src/index.css)가 1열로 강제한다.
            gridTemplateColumns: isResultExpanded
              ? "minmax(0, 1fr)"
              : isTutorOpen
                ? (mindmapData ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) 400px")
                : "minmax(0, 1fr)",
            gap: isTutorOpen && !isResultExpanded ? 12 : 0,
            alignItems: "stretch",
            // 확대 시 그리드(=튜터 1칸)가 화면 높이를 채우도록 높이를 명시한다. 자식 튜터의 height:100%가 먹히려면 부모 높이가 필요하다.
            height: isResultExpanded ? "calc(100vh - 70px)" : undefined,
          }}>
            {!isResultExpanded && (
              <div ref={mindmapPaneRef} style={{
                background: "var(--color-card)", borderRadius: 12, padding: 28,
                border: "1px solid var(--color-border-soft)",
                fontSize: 15, color: "var(--color-text)", lineHeight: 1.85,
                overflowX: "auto",
                minWidth: 0,
              }}>
                {mindmapData ? (
                  <MindmapView key={displayContent} data={mindmapData} onNodeFocus={(label, pathLabels) => askTutorWithQuestion(buildMindmapQuestion(label, pathLabels), null)} persistKey={summaryId ?? undefined} />
                ) : (
                  <SelectionAskButton onAsk={askTutorWithSelection} onAskSimple={askTutorSimpleWithSelection}>
                    <FormattedAiText content={displayContent} template={template} />
                  </SelectionAskButton>
                )}
              </div>
            )}

            {isTutorOpen && (
              <AITutorDrawer
                layout="embedded"
                embeddedHeight={mindmapData ? mindmapPaneHeight : undefined}
                open={isTutorOpen}
                onOpenChange={handleTutorOpenChange}
                expanded={isResultExpanded}
                onExpandedChange={setIsResultExpanded}
                contextTitle={contextTitle}
                contextMarkdown={realContent}
                sourceMarkdown={sourceMarkdown}
                sourcePages={sourcePages}
                summaryId={summaryId}
                threadId={threadId}
                suggestedQuestions={questions}
                initialQuestion={!isLoading ? initialTutorQuestion : undefined}
                pendingQuestion={tutorSelectionQuestion ?? undefined}
                disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
                resetHistory={resetTutorHistory}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

// 요약 결과의 전체 복사 / PDF 다운로드 / 퀴즈 생성하기 버튼 묶음.
// 자세히 보기 페이지(SummaryResultView)와 동일한 동작을, 자료 상세의 요약 탭에서 바로 쓰도록 분리했다.
// 숨김 export 노드(.pdf-print-area)·인쇄 CSS·안내 모달을 자체적으로 포함하므로, 버튼 줄 안에 그대로 넣으면 된다.
export const SummaryActions = ({ template, content }: { template: SummaryTemplate; content: string }) => {
  const { showToast } = useToast();
  const [pdfSaving, setPdfSaving] = useState(false);
  const [showPrintGuide, setShowPrintGuide] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  const mindmapData = template === "MINDMAP" && content ? parseMindmapJson(content) : null;
  // 복사 텍스트도 화면과 동일하게 정제: 본문 인라인 (출처:...)는 제거하고 헤딩 출처만 남긴다.
  const exportContent = template === "MINDMAP"
    ? content
    : collapseForLectureNote(template, simplifySoleFileSources(hoistSourceToHeadings(normalizeMarkdownContent(content))));
  const exportText = `${templateLabels[template]} 요약\n\n${exportContent}`;

  // 실제 인쇄(→ PDF 저장) 실행. 안내 팝업에서 '계속'을 누르면 호출된다.
  const runPrint = () => {
    setShowPrintGuide(false);
    const prevTitle = document.title;
    document.title = `tongkk-${template.toLowerCase()}-summary`;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    showToast("인쇄 창에서 '대상'을 'PDF로 저장'으로 선택하세요.", "info");
    window.print();
  };

  const handleDownload = async () => {
    if (pdfSaving) return;
    // 텍스트 요약: 브라우저 인쇄로 PDF 저장(텍스트 선택 가능). 마인드맵: 이미지 캡처(PDF).
    if (!mindmapData) {
      setShowPrintGuide(true);
      return;
    }
    if (!pdfExportRef.current) return;
    setPdfSaving(true);
    try {
      await document.fonts.ready;
      const exportNode = pdfExportRef.current;
      if (!exportNode) return;
      const backdrop = document.createElement("div");
      backdrop.setAttribute("data-pdf-backdrop", "");
      backdrop.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99998;"; // hex-ok: PDF 내보내기 라이트 고정
      document.body.appendChild(backdrop);
      exportNode.style.left = "0px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "99999";
      exportNode.style.letterSpacing = "0.01px";
      void exportNode.getBoundingClientRect();
      const canvas = await html2canvas(exportNode, {
        backgroundColor: "#ffffff", // hex-ok: PDF 내보내기 라이트 고정
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
      });
      document.body.removeChild(backdrop);
      exportNode.style.left = "-10000px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "-1";
      exportNode.style.letterSpacing = "";
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      let heightLeft = imgHeight;
      let y = margin;
      pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
      heightLeft -= contentHeight;
      while (heightLeft > 0) {
        pdf.addPage();
        y -= contentHeight;
        pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
        heightLeft -= contentHeight;
      }
      pdf.save(`tongkk-${template.toLowerCase()}-summary.pdf`);
      showToast("PDF를 다운로드했습니다.", "success");
    } catch {
      document.querySelectorAll<HTMLElement>('[data-pdf-backdrop]').forEach(el => el.remove());
      if (pdfExportRef.current) {
        pdfExportRef.current.style.left = "-10000px";
        pdfExportRef.current.style.zIndex = "-1";
        pdfExportRef.current.style.letterSpacing = "";
      }
      showToast("PDF 다운로드에 실패했습니다.", "error");
    } finally {
      setPdfSaving(false);
    }
  };

  const copySummaryToClipboard = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(exportText);
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = exportText;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    if (!copied) throw new Error("Clipboard copy failed");
  };

  const handleCopyAll = async () => {
    try {
      await copySummaryToClipboard();
      showToast("요약본 전체를 클립보드에 복사했습니다.", "success");
    } catch {
      showToast("전체 복사에 실패했습니다.", "error");
    }
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pdf-print-area, .pdf-print-area * { visibility: visible !important; }
          .pdf-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            z-index: auto !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      {showPrintGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF 저장 안내"
          onClick={() => setShowPrintGuide(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(440px, 100%)", background: "var(--color-card)", borderRadius: 20, padding: "32px 30px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--color-tint-cyan)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>📄</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>PDF로 저장하기</h3>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.8, color: "var(--color-text)", wordBreak: "keep-all" }}>
              <b style={{ color: CYAN }}>계속</b>을 누르면 <b style={{ color: "var(--color-text-strong)" }}>인쇄 창</b>이 열립니다.<br />
              프린터 대신 <b style={{ color: "var(--color-text-strong)" }}>PDF로 저장</b>을 선택하면 돼요.
            </p>
            <div style={{
              margin: "0 0 24px", padding: "16px 16px", borderRadius: 12, background: "var(--color-page)",
              fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)", wordBreak: "keep-all",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ flexShrink: 0 }}>💡</span>
              <span>
                저장된 PDF는 이미지가 아니라 문서 형태라서,<br />
                <b style={{ color: "var(--color-text-strong)" }}>텍스트 선택과 복사</b>가 가능해요.
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowPrintGuide(false)}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >취소</button>
              <button
                type="button"
                onClick={runPrint}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >계속</button>
            </div>
          </div>
        </div>
      )}
      <button type="button" className="tongkk-hover-tint" onClick={handleCopyAll} style={{
        padding: "9px 12px", borderRadius: 8, border: `1px solid ${BORDER_COLOR}`,
        background: "var(--color-card)", color: "var(--color-text)", fontSize: 12, fontWeight: 800, cursor: "pointer",
      }}>전체 복사</button>
      <button type="button" className="tongkk-hover-tint" onClick={handleDownload} disabled={pdfSaving} style={{
        padding: "9px 12px", borderRadius: 8, border: `1px solid ${BORDER_COLOR}`,
        background: "var(--color-card)", color: "var(--color-text)", fontSize: 12, fontWeight: 800,
        cursor: pdfSaving ? "default" : "pointer",
        opacity: pdfSaving ? 0.6 : 1,
      }}>{pdfSaving ? "PDF 생성 중" : "PDF 다운로드"}</button>
      <div
        ref={pdfExportRef}
        className="pdf-print-area"
        data-theme="light"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-10000px",
          top: 0,
          zIndex: -1,
          width: 794,
          padding: 48,
          background: "#fff", // hex-ok: PDF 내보내기 라이트 고정
          color: "#222", // hex-ok: PDF 내보내기 라이트 고정
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
          fontSize: 14,
          lineHeight: "25px",
          pointerEvents: "none",
        }}
      >
        <h1 style={{
          margin: "0 0 22px",
          paddingBottom: 14,
          borderBottom: "2px solid #f0f0f0", // hex-ok: PDF 내보내기 라이트 고정
          fontSize: 24,
          lineHeight: 1.35,
          color: "#222", // hex-ok: PDF 내보내기 라이트 고정
        }}>
          Tongkk {templateLabels[template]} 요약
        </h1>
        {mindmapData ? (
          <MindmapView key={`pdf-${content}`} data={mindmapData} printMode />
        ) : (
          <FormattedAiText content={content} template={template} />
        )}
      </div>
    </>
  );
};
