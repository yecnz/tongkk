import { useState } from "react";
import { PINK, CYAN, Card } from "../../common";

type QuizCreateViewProps = { fileName?: string; onBack: () => void; onCreate: () => void };

export const QuizCreateView = ({ fileName, onBack, onCreate }: QuizCreateViewProps) => {
  const [difficulty, setDifficulty] = useState("보통");
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<string[]>(["객관식"]);

  const toggleType = (t: string) => {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  return (
    <div>
      <button type="button" onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "var(--color-text-strong)" }}>퀴즈 생성</h2>

      <div className="summary-quizcreate-grid">
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-soft)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)" }}>요약된 파일 미리보기</span>
          </div>
          <div style={{
            padding: 24, minHeight: 360, background: "var(--color-surface)",
            fontSize: 13, color: "var(--color-text)", lineHeight: 1.8
          }}>
            <p style={{ fontWeight: 600, color: "var(--color-text-strong)", marginTop: 0 }}>{fileName || "업로드된 파일"} - 요약본</p>
            <p>이번 강의에서는 동적 프로그래밍(DP)의 핵심 개념을 다루었습니다. DP는 큰 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법입니다.</p>
            <p>메모이제이션과 타뷸레이션 두 가지 접근 방식이 있으며, 최적 부분 구조와 중복 부분 문제라는 두 가지 조건이 필요합니다.</p>
            <p>피보나치 수열, 배낭 문제, 최장 공통 부분 수열(LCS) 등의 대표적인 예제를 통해 DP의 적용 방법을 학습했습니다.</p>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>난이도</h3>
            <div style={{ display: "flex", gap: 10 }}>
              {["낮음", "보통", "높음"].map(d => (
                <button type="button" key={d} onClick={() => setDifficulty(d)} style={{
                  padding: "10px 24px", borderRadius: 10,
                  border: difficulty === d ? "none" : "1px solid var(--color-border-soft)",
                  background: difficulty === d ? PINK : "var(--color-card)",
                  color: difficulty === d ? "var(--color-on-brand)" : "var(--color-text)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>문항수</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: 80, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  fontSize: 14, textAlign: "center", outline: "none"
                }}
              />
              <span style={{ fontSize: 14, color: "var(--color-muted)" }}>개</span>
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>문제 유형</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["O/X", "객관식", "단답형", "주관식"].map(t => (
                <button type="button" key={t} onClick={() => toggleType(t)} style={{
                  padding: "10px 20px", borderRadius: 10,
                  border: types.includes(t) ? "none" : "1px solid var(--color-border-soft)",
                  background: types.includes(t) ? CYAN : "var(--color-card)",
                  color: types.includes(t) ? "var(--color-on-brand)" : "var(--color-text)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>
          </div>

          <button type="button" onClick={onCreate} style={{
            padding: "16px 0", borderRadius: 14, border: "none",
            background: PINK, color: "var(--color-on-brand)", fontSize: 16, fontWeight: 700,
            cursor: "pointer", marginTop: 8
          }}>퀴즈 생성하기</button>
        </div>
      </div>
    </div>
  );
};
