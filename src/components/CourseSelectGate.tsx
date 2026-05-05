import { useState } from "react";
import { PINK, CYAN, Card } from "../common";

type CourseSelectGateProps = {
  courses: string[];
  actionLabel: string;
  onSelect: (course: string) => void;
  onAddCourse: (name: string) => void;
};

const cardColors = ["#E8FAFE", "#F3F0FF", "#FFF6E7", "#EEF7F1", "#F7F8FB"];
const courseIcons = ["🧠", "📘", "🧩", "💡", "📝"];

export const CourseSelectGate = ({ courses, actionLabel, onSelect, onAddCourse }: CourseSelectGateProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newCourse, setNewCourse] = useState("");

  const handleAdd = () => {
    const name = newCourse.trim();
    if (!name) return;
    onAddCourse(name);
    onSelect(name);
    setNewCourse("");
    setIsAdding(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#222" }}>과목 선택</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#888" }}>{actionLabel}을 진행할 과목을 선택하세요</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
        <Card style={{ minHeight: 190, borderColor: "#DDE2EA", overflow: "hidden" }}>
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              style={{
                width: "100%",
                height: "100%",
                minHeight: 190,
                border: "none",
                background: "#fff",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
              }}
            >
              <span style={{
                width: 68,
                height: 68,
                borderRadius: "50%",
                background: "#F0F1FF",
                color: "#5361FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                fontWeight: 300,
              }}>+</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#222" }}>새 과목 만들기</span>
            </button>
          ) : (
            <div style={{ padding: 22 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 800, color: "#222" }}>새 과목 만들기</h3>
              <input
                value={newCourse}
                onChange={e => setNewCourse(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                autoFocus
                placeholder="과목명 입력"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid #E0E0E0",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  marginBottom: 14,
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setIsAdding(false); setNewCourse(""); }}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 10,
                    border: "1px solid #E0E0E0",
                    background: "#fff",
                    color: "#666",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >취소</button>
                <button
                  type="button"
                  onClick={handleAdd}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 10,
                    border: "none",
                    background: PINK,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >추가</button>
              </div>
            </div>
          )}
        </Card>

        {courses.map((course, index) => (
          <Card key={`${course}-${index}`} style={{ minHeight: 190, overflow: "hidden", background: cardColors[index % cardColors.length] }}>
            <button
              type="button"
              onClick={() => onSelect(course)}
              style={{
                width: "100%",
                minHeight: 190,
                padding: 26,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 42, lineHeight: 1 }}>{courseIcons[index % courseIcons.length]}</span>
                <span style={{ color: "#666", fontSize: 24, lineHeight: 1 }}>⋮</span>
              </div>
              <div>
                <h3 style={{
                  margin: "0 0 12px",
                  color: "#222",
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.35,
                  wordBreak: "keep-all",
                  overflowWrap: "break-word",
                }}>{course}</h3>
                <span style={{ color: index % 2 === 0 ? CYAN : PINK, fontSize: 14, fontWeight: 800 }}>
                  {actionLabel} 시작
                </span>
              </div>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
};
