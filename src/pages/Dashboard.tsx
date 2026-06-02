import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import type { PageRouteLabel } from "../common";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../services/quizAttempts";

type CourseModalProps = { onClose: () => void; onAdd: (name: string) => void };
type RenameCourseModalProps = { course: string; courses: string[]; onClose: () => void; onRename: (oldName: string, newName: string) => void };
type DeleteCourseModalProps = { course: string; onClose: () => void; onDelete: (name: string) => void };
type CourseDetailSection = "materials" | "summaries" | "quizzes";
type CourseStats = {
  materials: number;
  summaries: number;
  quizzes: number;
  loading: boolean;
  error: string;
};
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

const templateLabels: Record<SavedSummary["template"], string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

const defaultStats: CourseStats = {
  materials: 0,
  summaries: 0,
  quizzes: 0,
  loading: true,
  error: "",
};

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));

const materialMeta = (material: CourseMaterial) => {
  if (material.pages) return `${material.pages}페이지`;
  if (material.slides) return `${material.slides}슬라이드`;
  return material.type.toUpperCase();
};

const preview = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);

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
        {course}의 저장된 강의자료, 요약, 퀴즈도 함께 삭제됩니다.
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

const CourseDetailModal = ({
  course,
  initialSection = "materials",
  onClose,
  onGoSummary,
  onGoQuiz,
  onOpenMaterial,
  onOpenSummary,
  onOpenQuiz,
}: CourseDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<CourseDetailSection>(initialSection);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setActiveTab(initialSection);
  }, [initialSection]);

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
        if (!ignore) setError(err instanceof Error ? err.message : "강의 상세 정보를 불러오지 못했습니다.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void loadCourseDetail();
    return () => {
      ignore = true;
    };
  }, [course]);

  const emptyText = loading ? "불러오는 중..." : "아직 기록이 없습니다";
  const tabCount = {
    materials: materials.length,
    summaries: summaries.length,
    quizzes: quizSets.length,
  };
  const tabs: Array<{ key: CourseDetailSection; label: string; accent: string }> = [
    { key: "materials", label: "자료", accent: "#555" },
    { key: "summaries", label: "요약", accent: PINK },
    { key: "quizzes", label: "퀴즈", accent: CYAN },
  ];

  const tabButtonStyle = (tab: CourseDetailSection, accent: string) => {
    const selected = activeTab === tab;
    return {
      padding: "10px 16px",
      borderRadius: 999,
      border: selected ? `1px solid ${accent}` : "1px solid #eeeeee",
      background: selected ? (tab === "quizzes" ? "#E8FAFE" : tab === "summaries" ? "#FFF0F6" : "#f8f8f8") : "#fff",
      color: selected ? accent : "#777",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: selected ? 850 : 700,
    };
  };

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
        width: "min(900px, 100%)",
        maxHeight: "calc(100vh - 56px)",
        overflowY: "auto",
        padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 850, color: "#222" }}>{course}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>탭을 선택해 강의별 자료, 요약, 퀴즈 내역을 확인하세요.</p>
          </div>
          <button onClick={onClose} aria-label="강의 상세 닫기" style={{
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
          }}>x</button>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#FFF5F5", color: "#E53E3E", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {tabs.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} style={tabButtonStyle(tab.key, tab.accent)}>
              {tab.label} {tabCount[tab.key] > 0 ? tabCount[tab.key] : ""}
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid #eeeeee", borderRadius: 14, background: "#fff", minHeight: 320, padding: 18 }}>
          {activeTab === "materials" && (
            materials.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {materials.map((material, index) => (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => onOpenMaterial(material)}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      border: "none",
                      borderBottom: index < materials.length - 1 ? "1px solid #f3f3f3" : "none",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                      {material.name}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 12, color: "#999" }}>
                      {materialMeta(material)} · 수정일 {formatDate(material.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}

          {activeTab === "summaries" && (
            summaries.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {summaries.map((summary, index) => (
                  <button
                    key={summary.id || `${summary.template}-${index}`}
                    type="button"
                    onClick={() => onOpenSummary(summary)}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      border: "none",
                      borderBottom: index < summaries.length - 1 ? "1px solid #f3f3f3" : "none",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 850, color: PINK }}>{templateLabels[summary.template]}</span>
                      <span style={{ fontSize: 12, color: "#aaa", flexShrink: 0 }}>생성일 {formatDate(summary.createdAt)}</span>
                    </div>
                    <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preview(summary.content) || "요약 내용 없음"}
                    </p>
                  </button>
                ))}
              </div>
            )
          )}

          {activeTab === "quizzes" && (
            quizSets.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {quizSets.map((quizSet, index) => {
                  const latestAttempt = quizAttempts.find(attempt => attempt.quizSetId === quizSet.id);
                  return (
                    <button
                      key={quizSet.id}
                      type="button"
                      onClick={() => onOpenQuiz(quizSet)}
                      style={{
                        width: "100%",
                        padding: "14px 0",
                        border: "none",
                        borderBottom: index < quizSets.length - 1 ? "1px solid #f3f3f3" : "none",
                        background: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                        {quizSet.title}
                      </div>
                      <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#999" }}>
                          {quizSet.questionType} · {quizSet.difficulty} · {quizSet.count}문항
                        </span>
                        {latestAttempt ? (
                          <span style={{ flexShrink: 0, fontSize: 12, color: latestAttempt.scorePercent < 70 ? PINK : CYAN, fontWeight: 850 }}>
                            최근 점수 {latestAttempt.scorePercent}%
                          </span>
                        ) : (
                          <span style={{ flexShrink: 0, fontSize: 12, color: "#aaa", fontWeight: 800 }}>
                            풀이 전
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}
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
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [openCourseMenu, setOpenCourseMenu] = useState<string | null>(null);
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<string | null>(null);
  const [detailCourse, setDetailCourse] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<CourseDetailSection | undefined>(undefined);
  const [courseStats, setCourseStats] = useState<Record<string, CourseStats>>({});

  useEffect(() => {
    if (!openCourseMenu) return;
    const closeMenu = () => setOpenCourseMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openCourseMenu]);

  useEffect(() => {
    let ignore = false;
    if (courses.length === 0) {
      setCourseStats({});
      return () => {
        ignore = true;
      };
    }

    setCourseStats(prev => {
      const next: Record<string, CourseStats> = {};
      courses.forEach(course => {
        next[course] = prev[course] || { ...defaultStats };
      });
      return next;
    });

    const loadStats = async () => {
      await Promise.all(courses.map(async course => {
        try {
          const [materials, summaries, quizSets] = await Promise.all([
            loadCourseMaterialsFromServer(course),
            loadSummariesFromServer(course),
            loadQuizSetsFromServer(course),
          ]);
          if (ignore) return;
          setCourseStats(prev => ({
            ...prev,
            [course]: {
              materials: materials.length,
              summaries: summaries.length,
              quizzes: quizSets.length,
              loading: false,
              error: "",
            },
          }));
        } catch (err) {
          if (ignore) return;
          setCourseStats(prev => ({
            ...prev,
            [course]: {
              ...(prev[course] || defaultStats),
              loading: false,
              error: err instanceof Error ? err.message : "강의 정보를 불러오지 못했습니다.",
            },
          }));
        }
      }));
    };

    void loadStats();
    return () => {
      ignore = true;
    };
  }, [courses]);

  const openCourseDetail = (course: string, section: CourseDetailSection = "materials") => {
    setDetailSection(section);
    setDetailCourse(course);
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

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0", background: PAGE_BACKGROUND }}>
        <button onClick={() => setSidebar(true)} aria-label="메뉴 열기" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <main style={{ padding: "36px 24px", maxWidth: 1120, margin: "0 auto" }}>
        {courses.length === 0 ? (
          <div style={{
            minHeight: "calc(100vh - 160px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "#777",
          }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 850, color: "#222" }}>아직 등록된 강의가 없습니다.</h2>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#888" }}>강의를 추가하면 자료, 요약, 퀴즈를 관리할 수 있어요.</p>
            <button onClick={() => setShowAddCourse(true)} style={{
              padding: "11px 18px",
              borderRadius: 10,
              border: "none",
              background: PINK,
              color: "#fff",
              fontSize: 14,
              fontWeight: 850,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(240,112,174,0.22)",
            }}>+ 강의 추가하기</button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 18 }}>
            {courses.map(course => {
              const stats = courseStats[course] || defaultStats;
              const statsLabel = stats.loading
                ? "자료 - · 요약 - · 퀴즈 -"
                : `자료 ${stats.materials} · 요약 ${stats.summaries} · 퀴즈 ${stats.quizzes}`;

              return (
                <Card
                  key={course}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCourseDetail(course)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openCourseDetail(course);
                    }
                  }}
                  style={{
                    minHeight: 128,
                    padding: 20,
                    cursor: "pointer",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                >
                  <div>
                    <h2 style={{ margin: "0 34px 10px 0", fontSize: 18, fontWeight: 850, color: "#222", lineHeight: 1.35, wordBreak: "break-word" }}>
                      {course}
                    </h2>
                    <p style={{ margin: 0, fontSize: 13, color: stats.error ? "#E53E3E" : "#777", fontWeight: 700 }}>
                      {stats.error ? "강의 정보를 불러오지 못했습니다" : statsLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${course} 관리 메뉴`}
                    onClick={e => {
                      e.stopPropagation();
                      setOpenCourseMenu(prev => prev === course ? null : course);
                    }}
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      border: "1px solid #eeeeee",
                      background: openCourseMenu === course ? "#fafafa" : "#fff",
                      color: "#999",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: "26px",
                      padding: 0,
                    }}
                  >...</button>
                  {openCourseMenu === course && (
                    <div onClick={e => e.stopPropagation()} style={{ position: "absolute", right: 14, top: 48, width: 128, padding: 6, borderRadius: 12, border: "1px solid #eeeeee", background: "#fff", boxShadow: "0 12px 28px rgba(0,0,0,0.12)", zIndex: 20 }}>
                      <button
                        type="button"
                        onClick={() => { setOpenCourseMenu(null); setRenamingCourse(course); }}
                        style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "#fff", color: "#333", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}
                      >이름 변경</button>
                      <button
                        type="button"
                        onClick={() => { setOpenCourseMenu(null); setDeletingCourse(course); }}
                        style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "#fff", color: "#E53E3E", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 700 }}
                      >삭제</button>
                    </div>
                  )}
                </Card>
              );
            })}
            <button onClick={() => setShowAddCourse(true)} style={{
              minHeight: 128,
              borderRadius: 18,
              border: "1px dashed #d8dde8",
              background: "#fbfcfe",
              color: PINK,
              fontSize: 15,
              fontWeight: 850,
              cursor: "pointer",
              boxShadow: "none",
            }}>+ 강의 추가하기</button>
          </div>
        )}
      </main>
    </div>
  );
}
