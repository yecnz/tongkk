import { useState, useRef, useEffect, type ReactNode } from "react";
import { PINK } from "../../common";
import type { DragAnchor } from "./types";

// 요약 본문을 감싸 드래그 선택 시 "AI 튜터에게 묻기" 플로팅 버튼을 띄운다.
// 버튼 클릭 시 선택 텍스트를 onAsk로 넘긴다.
export const SelectionAskButton = ({ children, onAsk, onAskSimple }: { children: ReactNode; onAsk: (text: string, anchor: DragAnchor | null) => void; onAskSimple?: (text: string, anchor: DragAnchor | null) => void }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);

  const captureSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const wrap = wrapRef.current;
    if (!text || !sel || sel.rangeCount === 0 || !wrap) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!wrap.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    setSelection({
      text,
      top: rect.top - wrapRect.top,
      left: Math.min(Math.max(rect.left - wrapRect.left + rect.width / 2, 70), wrapRect.width - 70),
    });
  };

  // 본문 밖을 클릭하면 버튼을 숨긴다(버튼 자체 클릭은 stopPropagation으로 제외).
  useEffect(() => {
    const clear = () => setSelection(null);
    document.addEventListener("mousedown", clear);
    return () => document.removeEventListener("mousedown", clear);
  }, []);

  // 선택 영역의 화면상 위치를 기록해 두고(튜터가 열리며 칸 폭이 줄어드는 reflow가 일어난다),
  // 핸들러를 부른 뒤 같은 위치가 유지되도록 스크롤을 보정한다. '묻기'·'쉬운 설명' 버튼 공용.
  const runAsk = (handler: (text: string, anchor: DragAnchor | null) => void) => {
    if (!selection) return;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    const anchorTop = range ? range.getBoundingClientRect().top : null;
    handler(selection.text, range && anchorTop != null ? { range, top: anchorTop, scrollY: window.scrollY } : null);
    setSelection(null);
    sel?.removeAllRanges();
    if (range && anchorTop != null) {
      requestAnimationFrame(() => {
        const delta = range.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      });
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onMouseUp={captureSelection}>
      {children}
      {selection && (
        // 드래그 선택 시 '묻기'와 '쉬운 설명 보기' 두 칸을 나란히 띄운다(이슈 #66).
        <div
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onMouseUp={e => e.stopPropagation()}
          style={{
            position: "absolute",
            top: selection.top,
            left: selection.left,
            transform: "translate(-50%, calc(-100% - 8px))",
            zIndex: 50,
            display: "flex",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <button
            type="button"
            onClick={() => runAsk(onAsk)}
            style={{
              padding: "7px 12px", borderRadius: 999, border: "none",
              background: PINK, color: "var(--color-on-brand)", fontSize: 12, fontWeight: 800,
              boxShadow: "0 4px 14px rgba(0,0,0,0.18)", cursor: "pointer",
            }}
          >
            AI 튜터에게 묻기
          </button>
          {onAskSimple && (
            <button
              type="button"
              onClick={() => runAsk(onAskSimple)}
              style={{
                padding: "7px 12px", borderRadius: 999, border: "1px solid var(--color-border)",
                background: "var(--color-card)", color: PINK, fontSize: 12, fontWeight: 800,
                boxShadow: "0 4px 14px rgba(0,0,0,0.18)", cursor: "pointer",
              }}
            >
              쉬운 설명 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
};
