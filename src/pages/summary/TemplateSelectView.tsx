import { useState, type CSSProperties } from "react";
import { PINK, Card } from "../../common";
import type { SummaryTemplate } from "../../services/gpt";
import { summaryTypeIcon } from "./utils";

type TemplateSelectViewProps = { onSelect: (template: SummaryTemplate, opts?: { pageRange?: string; focusPrompt?: string }) => void; onBack: () => void; pageHint?: string };

export const TemplateSelectView = ({ onSelect, onBack, pageHint }: TemplateSelectViewProps) => {
  const [pageRange, setPageRange] = useState("");
  const [focusPrompt, setFocusPrompt] = useState("");
  // 아이콘 색은 브랜드 핑크 하나로 통일한다(색을 여러 개 쓰면 통일감이 없어 촌스러워진다).
  // 카드 구분은 색이 아니라 아이콘 모양이 담당. accent는 아이콘·호버 색(--accent)으로 쓴다.
  const templates: Array<{ key: SummaryTemplate; name: string; desc: string; accent: string }> = [
    { key: "GENERAL", name: "일반 요약", desc: "강의 자료 내용을 깔끔하게 정리", accent: PINK },
    { key: "LECTURE_NOTE", name: "강의 노트", desc: "개념, 흐름, 시험 포인트를 구조화", accent: PINK },
    { key: "MINDMAP", name: "마인드맵", desc: "중심 주제와 하위 개념의 관계를 구조화", accent: PINK },
    { key: "CHEAT_SHEET", name: "치트시트", desc: "시험 직전 빠르게 보는 암기표", accent: PINK },
  ];

  return (
    <div>
      <button type="button" onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "var(--color-text-strong)" }}>출력 템플릿 선택</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>요약 범위와 형식을 선택하세요</p>
      </div>

      <div style={{ display: "grid", gap: 14, marginBottom: 24, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 800, color: "var(--color-text)" }}>
            반영할 페이지 <span style={{ fontWeight: 600, color: "var(--color-muted)" }}>(선택 · 비우면 전체)</span>
          </label>
          <input
            value={pageRange}
            onChange={e => setPageRange(e.target.value)}
            placeholder={pageHint ? `예: 1-5, 8  (${pageHint})` : "예: 1-5, 8"}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)" }}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 800, color: "var(--color-text)" }}>
            집중할 내용 <span style={{ fontWeight: 600, color: "var(--color-muted)" }}>(선택)</span>
          </label>
          <textarea
            value={focusPrompt}
            onChange={e => setFocusPrompt(e.target.value)}
            placeholder="예: 시험에 나올 핵심 정의와 공식 위주로 정리해줘"
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
          />
        </div>
      </div>

      <div className="summary-template-grid">
        {templates.map(t => (
          <Card key={t.key} className="tongkk-hover-lift" style={{ padding: 0, overflow: "hidden" }}>
            <button type="button" onClick={() => onSelect(t.key, { pageRange, focusPrompt })} className="summary-template-card" style={{
              width: "100%",
              minHeight: 180,
              padding: 24,
              border: "none",
              background: "var(--color-card)",
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              "--accent": t.accent,
            } as CSSProperties}>
              <div>
                <div className="summary-template-icon" style={{
                  width: 44, height: 44, borderRadius: 12,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--color-muted-surface)",
                  color: t.accent,
                  marginBottom: 16, transition: "background 0.15s",
                }}>{summaryTypeIcon(t.key)}</div>
                <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>{t.name}</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{t.desc}</p>
              </div>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                <span className="summary-template-arrow" style={{
                  width: 30, height: 30, borderRadius: "50%",
                  border: "1px solid var(--color-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--color-text-secondary)",
                  transition: "background 0.15s, color 0.15s, border-color 0.15s",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </span>
              </div>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
};
