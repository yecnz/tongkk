import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import type { PageRouteLabel } from "../common";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../services/quizAttempts";
import { generateStudyPlan, type StudyPlanMode } from "../services/studyPlan";

type CourseModalProps = { onClose: () => void; onAdd: (name: string) => void };
type RenameCourseModalProps = { course: string; courses: string[]; onClose: () => void; onRename: (oldName: string, newName: string) => void };
type DeleteCourseModalProps = { course: string; onClose: () => void; onDelete: (name: string) => void };
type CourseDetailSection = "materials" | "summaries" | "quizzes";
type CourseDetailModalProps = {
  course: string;
  initialSection?: CourseDetailSection;
  onClose: () => void;
  onGoSummary: () => void;
  onGoQuiz: () => void;
  onOpenMaterial: (material: CourseMaterial) => void;
  onOpenSummary: (summary: SavedSummary) => void;
  onOpenQuiz: (quizSet: SavedQuizSet) => void;
};
type CustomCalendarProps = { value: string; onChange: (value: string) => void };
type DdayType = "assignment" | "event";
type AddDdayModalProps = { onClose: () => void; onAdd: (type: DdayType, subject: string, date: string) => void };
type AddPlanModalProps = { onClose: () => void; onAdd: (text: string) => void };
type Dday = { id?: string; type?: DdayType; subj: string; date: string };
type Plan = { id?: string; text: string; done: boolean; minutes?: number; sourceType?: DdayType | "carryover" };
type PlanSource = {
  key: string;
  label: string;
  meta: string;
  kind: DdayType | "carryover";
  daysLeft?: number;
  dday?: Dday;
  plan?: Plan;
};

const createClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ddayTypeLabels: Record<DdayType, string> = { assignment: "과제", event: "일정" };

const templateLabels: Record<SavedSummary["template"], string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));

const AddCourseModal = ({ onClose, onAdd }: CourseModalProps) => {
  const [name, setName] = useState("");
  const handleAdd = () => {
    const courseName = name.trim();
    if (!courseName) return;
    onAdd(courseName);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 추가</h3>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAdd(); }} placeholder="과목명 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleAdd} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

const RenameCourseModal = ({ course, courses, onClose, onRename }: RenameCourseModalProps) => {
  const [name, setName] = useState(course);
  const trimmedName = name.trim();
  const isDuplicate = trimmedName !== course && courses.includes(trimmedName);
  const canSave = Boolean(trimmedName) && !isDuplicate;

  const handleSave = () => {
    if (!canSave) return;
    onRename(course, trimmedName);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 이름 변경</h3>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: isDuplicate ? "1px solid #E53E3E" : "1px solid #e0e0e0",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: isDuplicate ? 8 : 16
          }}
        />
        {isDuplicate && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "#E53E3E" }}>이미 등록된 강의 이름입니다.</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleSave} disabled={!canSave} style={{
            padding: "8px 18px", borderRadius: 10, border: "none",
            background: canSave ? PINK : "#ddd", color: "#fff",
            cursor: canSave ? "pointer" : "default", fontSize: 14, fontWeight: 600
          }}>저장</button>
        </div>
      </Card>
    </div>
  );
};

const DeleteCourseModal = ({ course, onClose, onDelete }: DeleteCourseModalProps) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Card style={{ padding: 28, width: 360 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "#222" }}>강의를 삭제할까요?</h3>
      <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "#666" }}>
        {course}의 저장된 강의자료와 요약도 함께 삭제됩니다.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
        <button onClick={() => { onDelete(course); onClose(); }} style={{
          padding: "8px 18px", borderRadius: 10, border: "none",
          background: "#E53E3E", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700
        }}>삭제</button>
      </div>
    </Card>
  </div>
);

const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const DAY_NAMES = ["일","월","화","수","목","금","토"];

const CustomCalendar = ({ value, onChange }: CustomCalendarProps) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const selected = value ? new Date(value + "T00:00:00") : null;
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", borderRadius: 18, padding: "16px 12px", border: "1px solid rgba(255,255,255,0.8)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa", padding: "4px 10px", borderRadius: 8 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#222" }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa", padding: "4px 10px", borderRadius: 8 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0",
            color: i === 0 ? "#FF6B6B" : i === 6 ? "#5B9CF6" : "#aaa" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = selected &&
            selected.getFullYear() === viewYear &&
            selected.getMonth() === viewMonth &&
            selected.getDate() === day;
          const isToday =
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day;
          return (
            <button key={day} onClick={() => onChange(dateStr)} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%", border: "none",
              background: isSelected ? PINK : isToday ? "rgba(240,112,174,0.12)" : "transparent",
              color: isSelected ? "#fff" : isToday ? PINK : "#333",
              fontSize: 13, fontWeight: isSelected || isToday ? 700 : 400,
              cursor: "pointer", transition: "background 0.15s",
            }}>{day}</button>
          );
        })}
      </div>
    </div>
  );
};

const AddDdayModal = ({ onClose, onAdd }: AddDdayModalProps) => {
  const [type, setType] = useState<DdayType>("assignment");
  const [subj, setSubj] = useState("");
  const [date, setDate] = useState("");
  const title = type === "assignment" ? "과제 추가" : "일정 추가";
  const placeholder = type === "assignment" ? "과제명" : "일정명";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderRadius: 22, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>D-day 추가</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {(["assignment", "event"] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              style={{
                padding: "9px 0",
                borderRadius: 10,
                border: type === item ? `1px solid ${PINK}` : "1px solid #e0e0e0",
                background: type === item ? "#FFF0F6" : "rgba(255,255,255,0.8)",
                color: type === item ? PINK : "#666",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {ddayTypeLabels[item]}
            </button>
          ))}
        </div>
        <input value={subj} onChange={e => setSubj(e.target.value)} placeholder={placeholder} aria-label={title} style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 14,
          background: "rgba(255,255,255,0.8)"
        }}/>
        {date && (
          <div style={{ marginBottom: 10, fontSize: 13, color: PINK, fontWeight: 600, textAlign: "center" }}>
            선택된 날짜: {date}
          </div>
        )}
        <CustomCalendar value={date} onChange={setDate} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (subj.trim() && date) { onAdd(type, subj.trim(), date); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </div>
    </div>
  );
};

const AddPlanModal = ({ onClose, onAdd }: AddPlanModalProps) => {
  const [txt, setTxt] = useState("");
  const handleAdd = () => {
    const planText = txt.trim();
    if (!planText) return;
    onAdd(planText);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>학습 계획 추가</h3>
        <input
          value={txt}
          onChange={e => setTxt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          placeholder="학습 계획을 입력하세요"
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
          }}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleAdd} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: CYAN, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

const CourseDetailModal = ({
  course,
  initialSection,
  onClose,
  onGoSummary,
  onGoQuiz,
  onOpenMaterial,
  onOpenSummary,
  onOpenQuiz,
}: CourseDetailModalProps) => {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const materialSectionRef = useRef<HTMLDivElement | null>(null);
  const summarySectionRef = useRef<HTMLDivElement | null>(null);
  const quizSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;
    const loadCourseDetail = async () => {
      setLoading(true);
      setError("");
      try {
        const [nextMaterials, nextSummaries, nextQuizSets, nextQuizAttempts] = await Promise.all([
          loadCourseMaterialsFromServer(course),
          loadSummariesFromServer(course),
          loadQuizSetsFromServer(course),
          loadQuizAttemptsFromServer(course),
        ]);
        if (ignore) return;
        setMaterials(nextMaterials);
        setSummaries(nextSummaries);
        setQuizSets(nextQuizSets);
        setQuizAttempts(nextQuizAttempts);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "과목 상세 정보를 불러오지 못했습니다.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void loadCourseDetail();
    return () => {
      ignore = true;
    };
  }, [course]);

  useEffect(() => {
    if (!initialSection) return;
    const refBySection = {
      materials: materialSectionRef,
      summaries: summarySectionRef,
      quizzes: quizSectionRef,
    };
    requestAnimationFrame(() => {
      refBySection[initialSection].current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [initialSection]);

  const emptyText = loading ? "불러오는 중..." : "아직 기록이 없습니다";
  const preview = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);
  const sectionStyle = (section: CourseDetailSection) => ({
    border: initialSection === section ? `1px solid ${section === "quizzes" ? CYAN : PINK}66` : "1px solid #f0f0f0",
    borderRadius: 12,
    padding: 16,
    minHeight: 250,
    background: initialSection === section ? (section === "quizzes" ? "#F7FDFF" : "#FFF9FC") : "#fff",
  });

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 220,
      background: "rgba(0,0,0,0.32)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <Card style={{
        width: "min(980px, 100%)",
        maxHeight: "calc(100vh - 56px)",
        overflowY: "auto",
        padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#222" }}>{course}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>강의 자료, 요약 내역, 퀴즈 내역을 한 번에 확인합니다.</p>
          </div>
          <button onClick={onClose} aria-label="과목 상세 닫기" style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            border: "none",
            background: "#fafafa",
            color: "#999",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: "32px",
            padding: 0,
            flexShrink: 0,
          }}>×</button>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#FFF5F5", color: "#E53E3E", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div ref={materialSectionRef} style={sectionStyle("materials")}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#222" }}>강의 자료</h3>
            {materials.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {materials.map(material => (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => onOpenMaterial(material)}
                    style={{
                      width: "100%",
                      padding: "0 0 10px",
                      border: "none",
                      borderBottom: "1px solid #f5f5f5",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                      {material.name}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>
                      {material.pages ? `${material.pages}p` : material.slides ? `${material.slides}s` : material.type.toUpperCase()} · {formatDate(material.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={summarySectionRef} style={sectionStyle("summaries")}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#222" }}>요약 내역</h3>
            {summaries.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {summaries.map((summary, index) => (
                  <button
                    key={summary.id || `${summary.template}-${index}`}
                    type="button"
                    onClick={() => onOpenSummary(summary)}
                    style={{
                      width: "100%",
                      padding: "0 0 10px",
                      border: "none",
                      borderBottom: "1px solid #f5f5f5",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: PINK }}>{templateLabels[summary.template]}</span>
                      <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>{formatDate(summary.createdAt)}</span>
                    </div>
                    <p style={{ margin: "7px 0 0", fontSize: 12, lineHeight: 1.6, color: "#666" }}>
                      {preview(summary.content) || "요약 내용 없음"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={quizSectionRef} style={sectionStyle("quizzes")}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#222" }}>퀴즈 내역</h3>
            {quizSets.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {quizSets.map(quizSet => {
                  const latestAttempt = quizAttempts.find(attempt => attempt.quizSetId === quizSet.id);
                  return (
                    <button
                      key={quizSet.id}
                      type="button"
                      onClick={() => onOpenQuiz(quizSet)}
                      style={{
                        width: "100%",
                        padding: "0 0 10px",
                        border: "none",
                        borderBottom: "1px solid #f5f5f5",
                        background: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                        {quizSet.title}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>
                        {quizSet.questionType} · {quizSet.difficulty} · {quizSet.count}문항
                      </div>
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "#aaa" }}>{formatDate(quizSet.createdAt)}</span>
                        {latestAttempt ? (
                          <span style={{ flexShrink: 0, fontSize: 11, color: latestAttempt.scorePercent < 70 ? PINK : CYAN, fontWeight: 850 }}>
                            리포트 {latestAttempt.scorePercent}%
                          </span>
                        ) : (
                          <span style={{ flexShrink: 0, fontSize: 11, color: "#aaa", fontWeight: 800 }}>
                            풀이 전
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onGoSummary} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "#FFF0F6",
            color: PINK,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>자료 요약으로</button>
          <button onClick={onGoQuiz} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "#E8FAFE",
            color: CYAN,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>퀴즈 생성으로</button>
        </div>
      </Card>
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { courses, addCourse, renameCourse, deleteCourse } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const page: PageRouteLabel = "대시보드";
  const [ddays, setDdays] = useState<Dday[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dashboardStateLoaded, setDashboardStateLoaded] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showAddDday, setShowAddDday] = useState(false);
  const [showAllDdays, setShowAllDdays] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showStudyPlanOptions, setShowStudyPlanOptions] = useState(false);
  const [showPlanSourcePicker, setShowPlanSourcePicker] = useState(false);
  const [pendingStudyPlanMode, setPendingStudyPlanMode] = useState<StudyPlanMode>("balanced");
  const [selectedPlanSourceKeys, setSelectedPlanSourceKeys] = useState<string[]>([]);
  const [planSourceMessage, setPlanSourceMessage] = useState("");
  const [studyPlanMessage, setStudyPlanMessage] = useState("");
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const [studyPlanError, setStudyPlanError] = useState("");
  const [editingPlanKey, setEditingPlanKey] = useState<string | null>(null);
  const [editingPlanText, setEditingPlanText] = useState("");
  const [openCourseMenu, setOpenCourseMenu] = useState<string | null>(null);
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<string | null>(null);
  const [detailCourse, setDetailCourse] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<CourseDetailSection | undefined>(undefined);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      loadDashboardState<Dday[]>("ddays", []),
      loadDashboardState<Plan[]>("plans", []),
    ])
      .then(([nextDdays, nextPlans]) => {
        if (ignore) return;
        setDdays(nextDdays.map(item => ({ ...item, type: item.type || "assignment" })));
        setPlans(nextPlans);
        setDashboardStateLoaded(true);
      })
      .catch(error => {
        console.warn("대시보드 상태 불러오기 실패", error);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("ddays", ddays).catch(console.warn);
  }, [dashboardStateLoaded, ddays]);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("plans", plans).catch(console.warn);
  }, [dashboardStateLoaded, plans]);

  useEffect(() => {
    if (!openCourseMenu) return;
    const closeMenu = () => setOpenCourseMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openCourseMenu]);

  const getDaysLeft = (dateStr: string) => {
    const t = new Date(dateStr); const n = new Date();
    t.setHours(0,0,0,0); n.setHours(0,0,0,0);
    return Math.ceil((t.getTime() - n.getTime()) / 86400000);
  };

  // 날짜 가까운 순 자동 정렬
  const sortedDdays = [...ddays].sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
  const displayDdays = showAllDdays ? sortedDdays : sortedDdays.slice(0, 3);
  const incompletePlans = plans.filter(plan => !plan.done);
  const makeDdaySourceKey = (dday: Dday, index: number) => `dday-${dday.id || `${dday.subj}-${dday.date}-${index}`}`;
  const makePlanSourceKey = (plan: Plan, index: number) => `plan-${plan.id || `${plan.text}-${index}`}`;
  const formatDdayLabel = (daysLeft: number) => daysLeft > 0 ? `D-${daysLeft}` : daysLeft === 0 ? "D-Day" : `D+${Math.abs(daysLeft)}`;
  const planSources: PlanSource[] = [
    ...sortedDdays.map((dday, index) => {
      const daysLeft = getDaysLeft(dday.date);
      const type = dday.type || "assignment";
      return {
        key: makeDdaySourceKey(dday, index),
        label: dday.subj,
        meta: `${ddayTypeLabels[type]} ${formatDdayLabel(daysLeft)}`,
        kind: type,
        daysLeft,
        dday,
      };
    }),
    ...incompletePlans.map((plan, index) => ({
      key: makePlanSourceKey(plan, index),
      label: plan.text,
      meta: "미완료",
      kind: "carryover" as const,
      plan,
    })),
  ];
  const canGenerateStudyPlan = planSources.length > 0;
  const selectedPlanSources = planSources.filter(source => selectedPlanSourceKeys.includes(source.key));
  const carryoverPlanSources = planSources.filter(source => source.kind === "carryover");
  const ddayPlanSources = planSources.filter(source => source.kind !== "carryover");

  const summarizePlanSources = (sources: PlanSource[], mode: StudyPlanMode) => {
    const carryoverCount = sources.filter(source => source.kind === "carryover").length;
    const assignmentCount = sources.filter(source => source.kind === "assignment").length;
    const eventCount = sources.filter(source => source.kind === "event").length;
    const parts = [
      carryoverCount ? `미완료 계획 ${carryoverCount}개` : "",
      assignmentCount ? `가까운 과제 ${assignmentCount}개` : "",
      eventCount ? `가까운 일정 ${eventCount}개` : "",
    ].filter(Boolean);
    if (parts.length === 0) return "자동으로 고른 항목이 없어요. 반영할 항목을 선택해 주세요.";
    if (mode === "lighter") return `${parts.join("와 ")}만 가볍게 반영할게요.`;
    if (mode === "harder") return `${parts.join("와 ")}를 조금 빡세게 반영할게요.`;
    if (mode === "assignment") return `과제 중심으로 ${parts.join("와 ")}를 골라뒀어요.`;
    if (mode === "event") return `일정 위주로 ${parts.join("와 ")}를 골라뒀어요.`;
    return `${parts.join("와 ")}를 반영할게요.`;
  };

  const getRecommendedPlanSourceKeys = (mode: StudyPlanMode) => {
    const carryoverLimit = mode === "harder" ? 5 : mode === "lighter" ? 1 : mode === "event" ? 1 : 2;
    const ddayLimit = mode === "harder" ? 5 : mode === "lighter" ? 1 : 3;
    const carryoverSources = planSources
      .filter(source => source.kind === "carryover")
      .slice(0, carryoverLimit);
    const ddaySources = planSources
      .filter(source => {
        const daysLeft = source.daysLeft ?? 999;
        if (mode === "assignment") return source.kind === "assignment" && daysLeft <= 10;
        if (mode === "event") return source.kind === "event" && daysLeft <= 7;
        if (mode === "lighter") return source.kind === "assignment" ? daysLeft <= 3 : daysLeft <= 1;
        if (mode === "harder") return source.kind === "assignment" ? daysLeft <= 14 : daysLeft <= 2;
        return source.kind === "assignment" ? daysLeft <= 7 : daysLeft <= 1;
      })
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, ddayLimit);
    return [...carryoverSources, ...ddaySources].map(source => source.key);
  };

  const openPlanSourcePicker = (mode: StudyPlanMode) => {
    if (!canGenerateStudyPlan) return;
    const recommendedKeys = getRecommendedPlanSourceKeys(mode);
    const recommendedSources = planSources.filter(source => recommendedKeys.includes(source.key));
    setPendingStudyPlanMode(mode);
    setSelectedPlanSourceKeys(recommendedKeys);
    setPlanSourceMessage(summarizePlanSources(recommendedSources, mode));
    setStudyPlanError("");
    setShowPlanSourcePicker(true);
  };

  const requestStudyPlan = async () => {
    if (selectedPlanSources.length === 0 || studyPlanLoading) return;
    setStudyPlanLoading(true);
    setStudyPlanError("");
    try {
      const selectedDdays = selectedPlanSources
        .map(source => source.dday)
        .filter((dday): dday is Dday => Boolean(dday));
      const selectedIncompletePlans = selectedPlanSources
        .map(source => source.plan)
        .filter((plan): plan is Plan => Boolean(plan));
      const result = await generateStudyPlan(selectedDdays, selectedIncompletePlans, pendingStudyPlanMode);
      setStudyPlanMessage(result.message);
      setPlans(result.items.map(item => ({
        id: createClientId(),
        text: `${item.text} ${item.minutes}분`,
        done: false,
        minutes: item.minutes,
        sourceType: item.sourceType,
      })));
      setShowPlanSourcePicker(false);
    } catch (err) {
      setStudyPlanError(err instanceof Error ? err.message : "학습 계획 생성 실패");
    } finally {
      setStudyPlanLoading(false);
    }
  };

  const deleteDday = (target: Dday) => {
    setDdays(prev => {
      if (target.id) return prev.filter(item => item.id !== target.id);

      const targetIndex = prev.findIndex(item => item.subj === target.subj && item.date === target.date);
      if (targetIndex < 0) return prev;
      return prev.filter((_, index) => index !== targetIndex);
    });
  };

  const deletePlan = (target: Plan, targetIndex: number) => {
    setPlans(prev => prev.filter((item, index) =>
      target.id ? item.id !== target.id : index !== targetIndex
    ));
  };

  const togglePlanSource = (sourceKey: string) => {
    setSelectedPlanSourceKeys(prev =>
      prev.includes(sourceKey)
        ? prev.filter(key => key !== sourceKey)
        : [...prev, sourceKey]
    );
  };

  const startEditPlan = (plan: Plan, index: number) => {
    setEditingPlanKey(plan.id || `index-${index}`);
    setEditingPlanText(plan.text);
  };

  const finishEditPlan = (target: Plan, targetIndex: number) => {
    const nextText = editingPlanText.trim();
    setEditingPlanKey(null);
    setEditingPlanText("");
    if (!nextText) return;
    setPlans(prev => prev.map((item, index) => {
      const isTarget = target.id ? item.id === target.id : index === targetIndex;
      return isTarget ? { ...item, text: nextText } : item;
    }));
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showAddCourse && <AddCourseModal onClose={() => setShowAddCourse(false)} onAdd={addCourse} />}
      {renamingCourse && <RenameCourseModal course={renamingCourse} courses={courses} onClose={() => setRenamingCourse(null)} onRename={renameCourse} />}
      {deletingCourse && <DeleteCourseModal course={deletingCourse} onClose={() => setDeletingCourse(null)} onDelete={deleteCourse} />}
      {detailCourse && (
        <CourseDetailModal
          course={detailCourse}
          initialSection={detailSection}
          onClose={() => {
            setDetailCourse(null);
            setDetailSection(undefined);
          }}
          onGoSummary={() => {
            navigate(pageRoutes["자료 요약"], { state: { selectedCourse: detailCourse, fromDashboard: true } });
          }}
          onGoQuiz={() => {
            navigate(pageRoutes["퀴즈 생성"], { state: { course: detailCourse, fromDashboard: true } });
          }}
          onOpenMaterial={(material) => {
            navigate(pageRoutes["자료 요약"], {
              state: { selectedCourse: detailCourse, materialId: material.id, viewMaterial: true, fromDashboard: true },
            });
          }}
          onOpenSummary={(summary) => {
            navigate(pageRoutes["자료 요약"], {
              state: {
                selectedCourse: detailCourse,
                summaryId: summary.id,
                summaryTemplate: summary.template,
                summaryContent: summary.content,
                summaryCreatedAt: summary.createdAt,
                materialIds: summary.materialIds || [],
                openSummary: true,
                fromDashboard: true,
              },
            });
          }}
          onOpenQuiz={(quizSet) => {
            navigate(pageRoutes["퀴즈 생성"], {
              state: { course: detailCourse, quizSetId: quizSet.id, openQuiz: true, fromDashboard: true },
            });
          }}
        />
      )}
      {showAddDday && <AddDdayModal onClose={() => setShowAddDday(false)} onAdd={(type, s, d) => setDdays(prev => [...prev, { id: createClientId(), type, subj: s, date: d }])} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={t => setPlans(prev => [...prev, { id: createClientId(), text: t, done: false }])} />}

      {/* Header */}
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      {/* Content */}
      <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
          {/* Left */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* 강의 목록 */}
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 14px", color: "#222" }}>강의 목록</h2>
              <Card style={{ padding: 20 }}>
                {courses.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "30px 0", color: "#aaa" }}>
                    <p style={{ margin: "0 0 16px", fontSize: 14 }}>등록된 강의가 없습니다</p>
                    <button onClick={() => setShowAddCourse(true)} style={{
                      padding: "10px 22px", borderRadius: 12, border: "none", background: PINK, color: "#fff",
                      fontSize: 14, fontWeight: 600, cursor: "pointer"
                    }}>+ 강의 추가하기</button>
                  </div>
                ) : (
                  <div>
                    {courses.map((c, i) => (
                      <div key={c} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "14px 0", borderBottom: i < courses.length - 1 ? "1px solid #f5f5f5" : "none",
                        position: "relative",
                      }}>
                        <button
                          type="button"
                          onClick={() => {
                            setDetailSection(undefined);
                            setDetailCourse(c);
                          }}
                          style={{
                            border: "none",
                            background: "none",
                            padding: 0,
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#333",
                            cursor: "pointer",
                            textAlign: "left",
                            lineHeight: 1.4,
                            minWidth: 0,
                          }}
                        >
                          {c}
                        </button>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {([
                            { label: "강의자료", section: "materials", color: "#666", background: "#f7f7f7" },
                            { label: "요약 내역", section: "summaries", color: PINK, background: "#FFF0F6" },
                            { label: "퀴즈 내역", section: "quizzes", color: CYAN, background: "#E8FAFE" },
                          ] as const).map(btn => (
                            <button
                              key={btn.label}
                              type="button"
                              onClick={() => {
                                setOpenCourseMenu(null);
                                setDetailSection(btn.section);
                                setDetailCourse(c);
                              }}
                              style={{
                              padding: "6px 14px", borderRadius: 8,
                              border: "none",
                              background: btn.background,
                              color: btn.color,
                              fontSize: 13, fontWeight: 600, cursor: "pointer"
                            }}>{btn.label}</button>
                          ))}
                          <div style={{ width: 1, height: 18, background: "#d1d1d1", margin: "0 2px 0 4px" }} />
                          <button
                            type="button"
                            aria-label={`${c} 관리 메뉴`}
                            title="강의 관리"
                            onClick={e => {
                              e.stopPropagation();
                              setOpenCourseMenu(prev => prev === c ? null : c);
                            }}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 9,
                              border: "1px solid #eeeeee",
                              background: openCourseMenu === c ? "#fafafa" : "#fff",
                              color: "#999",
                              cursor: "pointer",
                              fontSize: 18,
                              lineHeight: "26px",
                              padding: 0,
                            }}
                          >
                            ⋯
                          </button>
                          {openCourseMenu === c && (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 50,
                                width: 128,
                                padding: 6,
                                borderRadius: 12,
                                border: "1px solid #eeeeee",
                                background: "#fff",
                                boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
                                zIndex: 20,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCourseMenu(null);
                                  setRenamingCourse(c);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "9px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "#fff",
                                  color: "#333",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                이름 변경
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCourseMenu(null);
                                  setDeletingCourse(c);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "9px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "#fff",
                                  color: "#E53E3E",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  fontSize: 13,
                                  fontWeight: 700,
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setShowAddCourse(true)} style={{
                      marginTop: 14, padding: "10px 0", width: "100%", borderRadius: 10,
                      border: "1px dashed #ddd", background: "#fafafa", color: "#999",
                      fontSize: 14, cursor: "pointer"
                    }}>+ 강의 추가하기</button>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Right */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* D-day */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: PINK }}>D-day</h3>
                <button onClick={() => setShowAddDday(true)} style={{
                  background: "none", border: "none", fontSize: 20, color: PINK, cursor: "pointer", lineHeight: 1
                }}>+</button>
              </div>
              {sortedDdays.length === 0 ? (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "10px 0" }}>설정된 D-day가 없습니다</p>
              ) : (
                <>
                  {displayDdays.map((d, i) => {
                    const left = getDaysLeft(d.date);
                    const type = d.type || "assignment";
                    return (
                      <div key={d.id || `${d.subj}-${d.date}-${i}`} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 0", borderBottom: i < displayDdays.length - 1 ? "1px solid #f5f5f5" : "none"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0,
                            padding: "3px 7px",
                            borderRadius: 999,
                            background: type === "assignment" ? "#FFF0F6" : "#E8FAFE",
                            color: type === "assignment" ? PINK : CYAN,
                            fontSize: 11,
                            fontWeight: 800,
                          }}>{ddayTypeLabels[type]}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: "#333", wordBreak: "break-word" }}>{d.subj}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: left <= 7 ? PINK : CYAN }}>
                            {left > 0 ? `D-${left}` : left === 0 ? "D-Day!" : `D+${Math.abs(left)}`}
                          </span>
                          <button
                            onClick={() => deleteDday(d)}
                            aria-label={`${d.subj} D-day 삭제`}
                            title="삭제"
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 8,
                              border: "1px solid #eeeeee",
                              background: "#fff",
                              color: "#bbb",
                              cursor: "pointer",
                              fontSize: 15,
                              lineHeight: "22px",
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {sortedDdays.length > 3 && (
                    <button onClick={() => setShowAllDdays(!showAllDdays)} style={{
                      marginTop: 10, padding: "6px 0", width: "100%", background: "none",
                      border: "none", color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 500
                    }}>{showAllDdays ? "접기" : `더보기 (${sortedDdays.length - 3}개)`}</button>
                  )}
                </>
              )}
            </Card>

            {/* 오늘의 학습계획 */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>오늘의 학습계획</h3>
              </div>
              {studyPlanMessage ? (
                <p style={{ margin: "0 0 12px", color: "#555", fontSize: 13, lineHeight: 1.6 }}>{studyPlanMessage}</p>
              ) : (
                <p style={{ margin: "0 0 12px", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                  D-day와 미완료 항목을 보고 오늘 할 일을 자동으로 쪼개드릴게요.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: showStudyPlanOptions ? 8 : 14 }}>
                <div style={{ display: "flex", gap: 4, minWidth: 0, flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => openPlanSourcePicker(plans.length ? "reroll" : "balanced")}
                    disabled={!canGenerateStudyPlan || studyPlanLoading}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${!canGenerateStudyPlan || studyPlanLoading ? "#e5e5e5" : CYAN}`,
                      background: "#fff",
                      color: !canGenerateStudyPlan || studyPlanLoading ? "#aaa" : CYAN,
                      cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {studyPlanLoading ? "생성 중..." : "AI가 짜기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStudyPlanOptions(prev => !prev)}
                    aria-label="AI 계획 옵션 열기"
                    title="AI 계획 옵션"
                    style={{
                      width: 30,
                      flexShrink: 0,
                      borderRadius: 8,
                      border: "1px solid #eaf7fa",
                      background: "#fff",
                      color: CYAN,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 800,
                      padding: 0,
                    }}
                  >
                    {showStudyPlanOptions ? "⌃" : "⌄"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddPlan(true)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${CYAN}`,
                    background: "#fff",
                    color: CYAN,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  직접 추가하기
                </button>
              </div>
              {showStudyPlanOptions && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {([
                    { label: "더 가볍게", mode: "lighter" },
                    { label: "더 빡세게", mode: "harder" },
                    { label: "과제 위주", mode: "assignment" },
                    { label: "일정 위주", mode: "event" },
                  ] as const).map(action => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => openPlanSourcePicker(action.mode)}
                      disabled={!canGenerateStudyPlan || studyPlanLoading}
                      style={{
                        padding: "6px 9px",
                        borderRadius: 8,
                        border: "1px solid #f0f0f0",
                        background: !canGenerateStudyPlan || studyPlanLoading ? "#f2f2f2" : "#fff",
                        color: !canGenerateStudyPlan || studyPlanLoading ? "#aaa" : "#666",
                        cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {showPlanSourcePicker && (
                <div style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #eef7f9",
                  background: "#fbfeff",
                }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55, color: "#555" }}>
                    {planSourceMessage}
                  </p>
                  {([
                    { title: "남아있는 학습계획", sources: carryoverPlanSources },
                    { title: "D-day", sources: ddayPlanSources },
                  ] as const).map(group => (
                    group.sources.length > 0 && (
                      <div key={group.title} style={{ marginBottom: 12 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "#999" }}>{group.title}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {group.sources.map(source => {
                            const selected = selectedPlanSourceKeys.includes(source.key);
                            const accent = source.kind === "event" ? CYAN : source.kind === "assignment" ? PINK : "#777";
                            return (
                              <button
                                key={source.key}
                                type="button"
                                onClick={() => togglePlanSource(source.key)}
                                style={{
                                  maxWidth: "100%",
                                  padding: "6px 9px",
                                  borderRadius: 999,
                                  border: `1px solid ${selected ? accent : "#eeeeee"}`,
                                  background: selected ? (source.kind === "event" ? "#E8FAFE" : source.kind === "assignment" ? "#FFF0F6" : "#f7f7f7") : "#fff",
                                  color: selected ? accent : "#777",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: selected ? 800 : 650,
                                  textAlign: "left",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {selected ? "✓ " : ""}{source.label} {source.meta}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  ))}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setShowPlanSourcePicker(false)}
                      style={{
                        padding: "7px 11px",
                        borderRadius: 8,
                        border: "1px solid #eeeeee",
                        background: "#fff",
                        color: "#777",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 750,
                      }}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={requestStudyPlan}
                      disabled={selectedPlanSources.length === 0 || studyPlanLoading}
                      style={{
                        padding: "7px 11px",
                        borderRadius: 8,
                        border: "none",
                        background: selectedPlanSources.length === 0 || studyPlanLoading ? "#ddd" : CYAN,
                        color: "#fff",
                        cursor: selectedPlanSources.length === 0 || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {studyPlanLoading ? "생성 중..." : "이대로 짜기"}
                    </button>
                  </div>
                </div>
              )}
              {studyPlanError && (
                <p style={{ margin: "0 0 12px", padding: 10, borderRadius: 9, background: "#FFF5F5", color: "#E53E3E", fontSize: 12, lineHeight: 1.5 }}>
                  {studyPlanError}
                </p>
              )}
              {!canGenerateStudyPlan && (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "6px 0 12px", margin: 0 }}>
                  먼저 D-day에 과제나 일정을 추가해보세요
                </p>
              )}
              {plans.length === 0 ? (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "6px 0", margin: 0 }}>아직 생성된 계획이 없습니다</p>
              ) : (
                plans.map((p, i) => {
                  const planKey = p.id || `index-${i}`;
                  const isEditing = editingPlanKey === planKey;
                  return (
                    <div key={p.id || `${p.text}-${i}`} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                      borderBottom: i < plans.length - 1 ? "1px solid #f5f5f5" : "none"
                    }}>
                      <button onClick={() => {
                        setPlans(prev => prev.map((item, index) => index === i ? { ...item, done: !item.done } : item));
                      }} style={{
                        width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "#ddd"}`,
                        background: p.done ? CYAN : "#fff", cursor: "pointer", display: "flex",
                        alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
                      }}>
                        {p.done && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
                      </button>
                      {isEditing ? (
                        <input
                          value={editingPlanText}
                          onChange={e => setEditingPlanText(e.target.value)}
                          onBlur={() => finishEditPlan(p, i)}
                          onKeyDown={e => {
                            if (e.key === "Enter") finishEditPlan(p, i);
                            if (e.key === "Escape") {
                              setEditingPlanKey(null);
                              setEditingPlanText("");
                            }
                          }}
                          autoFocus
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: "7px 9px",
                            borderRadius: 8,
                            border: `1px solid ${CYAN}`,
                            outline: "none",
                            fontSize: 14,
                            color: "#333",
                            boxSizing: "border-box",
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditPlan(p, i)}
                          title="클릭해서 수정"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: "none",
                            background: "none",
                            padding: 0,
                            cursor: "text",
                            textAlign: "left",
                            fontSize: 14,
                            color: p.done ? "#bbb" : "#444",
                            textDecoration: p.done ? "line-through" : "none",
                            lineHeight: 1.45,
                            wordBreak: "break-word",
                          }}
                        >
                          {p.text}
                        </button>
                      )}
                      <button
                        onClick={() => deletePlan(p, i)}
                        aria-label={`${p.text} 학습 계획 삭제`}
                        title="삭제"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          border: "1px solid #eeeeee",
                          background: "#fff",
                          color: "#bbb",
                          cursor: "pointer",
                          fontSize: 15,
                          lineHeight: "22px",
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
