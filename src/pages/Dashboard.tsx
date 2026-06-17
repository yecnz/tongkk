import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, BORDER_COLOR, FEEDBACK_EMAIL, pageRoutes, SidebarIcon, PaperPlaneIcon, Sidebar, Card, NoticeBanner } from "../common";
import { useCourses } from "../CourseContext";
import { useAuth } from "../AuthContext";
import { useTutorial } from "../TutorialContext";
import { TutorialHelpButton } from "../components/TutorialHelpButton";
import { useAuthGate } from "../AuthGateContext";
import { useSampleDemo } from "../SampleDemoContext";
import { useToast } from "../ToastContext";
import type { PageRouteLabel } from "../common";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { loadCourseMaterialsFromServer, countCourseMaterialsFromServer, deleteCourseMaterialFromServer, type CourseMaterial } from "../services/materials";
import { MaterialDeleteConfirmModal } from "../components/MaterialDeleteConfirmModal";
import { loadSummariesFromServer, countSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, countQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer } from "../services/quizAttempts";
import { generateStudyPlan, type StudyPlanMode, type StudyPlanGoal, type StudyPlanFamiliarity } from "../services/studyPlan";
import {
  isPaceSprint,
  paceCatchUpTarget,
  paceDateKey,
  paceProgressPct,
  paceReadiness,
  paceRemaining,
  paceStatus,
  paceTodayTarget,
  readinessTier,
  type PacePlan,
  type PaceStatus,
} from "../services/pace";
import {
  createClientId,
  ddayTypeColors,
  ddayTypeLabels,
  formatDdayLabel,
  getDaysLeft,
  PACE_NO_DDAY_HORIZON_DAYS,
  type Dday,
  type DdayType,
  type Plan,
  type PlanAction,
} from "../services/studyPlanner";
import { AddDdayModal, AddPlanModal } from "../components/PlannerModals";

type CourseModalProps = { onClose: () => void; onAdd: (name: string) => void; onAddAndUpload: (name: string) => void };
type RenameCourseModalProps = { course: string; courses: string[]; onClose: () => void; onRename: (oldName: string, newName: string) => void };
type DeleteCourseModalProps = { course: string; onClose: () => void; onDelete: (name: string) => void };
type CourseDetailSection = "materials" | "summaries" | "quizzes";
type CourseDetailModalProps = {
  course: string;
  initialSection?: CourseDetailSection;
  onClose: () => void;
  onGoSummary: () => void;
  onGoQuiz: () => void;
  onOpenMaterial: (material: CourseMaterial, initialTab?: "original" | "summary" | "quiz") => void;
  // 자료 삭제 후 대시보드 강의 카드의 "자료 N · 요약 N" 통계를 갱신하기 위한 알림.
  onMaterialDeleted?: () => void;
};
type PlanSource = {
  key: string;
  label: string;
  meta: string;
  kind: DdayType | "review";
  daysLeft?: number;
  dday?: Dday;
  // kind가 review일 때: 간격 반복 복습 후보 정보.
  review?: { course: string; daysSince: number; scorePercent: number };
};

type CourseStats = {
  materials: number;
  summaries: number;
  quizzes: number;
  loading: boolean;
  error: string;
};

const defaultStats: CourseStats = { materials: 0, summaries: 0, quizzes: 0, loading: true, error: "" };

const materialMeta = (material: CourseMaterial) => {
  if (material.pages) return `${material.pages}페이지`;
  if (material.slides) return `${material.slides}슬라이드`;
  return material.type.toUpperCase();
};

const AddCourseModal = ({ onClose, onAdd, onAddAndUpload }: CourseModalProps) => {
  const [name, setName] = useState("");
  const courseName = name.trim();
  const handleAdd = () => {
    if (!courseName) return;
    onAdd(courseName);
    onClose();
  };
  // 새 과목의 다음 단계는 거의 항상 자료 업로드라, 추가와 동시에 업로드 화면으로 잇는 경로를 기본 동선으로 둔다.
  const handleAddAndUpload = () => {
    if (!courseName) return;
    onAddAndUpload(courseName);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Card style={{ padding: 28, width: "min(400px, 100%)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 추가</h3>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddAndUpload(); }} placeholder="과목명 입력" aria-label="과목명" autoFocus style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 8
        }}/>
        {/* 버튼이 비활성인 이유를 알 수 있게 안내한다(빈 값 제출이 조용히 막히면 고장으로 느껴짐). */}
        {!courseName && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--color-muted)" }}>과목명을 입력하면 추가할 수 있어요.</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button type="button" onClick={handleAdd} disabled={!courseName} style={{
            padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
            background: "var(--color-card)", color: courseName ? "var(--color-text)" : "var(--color-muted)",
            cursor: courseName ? "pointer" : "default", fontSize: 14, fontWeight: 600
          }}>추가만 하기</button>
          <button type="button" onClick={handleAddAndUpload} disabled={!courseName} style={{
            padding: "8px 18px", borderRadius: 10, border: "none",
            background: courseName ? PINK : "var(--color-border-soft)", color: "var(--color-on-brand)",
            cursor: courseName ? "pointer" : "default", fontSize: 14, fontWeight: 600
          }}>추가하고 자료 올리기</button>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Card style={{ padding: 28, width: "min(340px, 100%)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 이름 변경</h3>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: isDuplicate ? "1px solid var(--color-danger)" : "1px solid var(--color-border-soft)",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: isDuplicate ? 8 : 16
          }}
        />
        {isDuplicate && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--color-danger)" }}>이미 등록된 강의 이름입니다.</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button type="button" onClick={handleSave} disabled={!canSave} style={{
            padding: "8px 18px", borderRadius: 10, border: "none",
            background: canSave ? PINK : "var(--color-border-soft)", color: "var(--color-on-brand)",
            cursor: canSave ? "pointer" : "default", fontSize: 14, fontWeight: 600
          }}>저장</button>
        </div>
      </Card>
    </div>
  );
};

const DeleteCourseModal = ({ course, onClose, onDelete }: DeleteCourseModalProps) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Card style={{ padding: 28, width: "min(360px, 100%)" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>강의를 삭제할까요?</h3>
      <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
        {course}의 저장된 강의자료, 요약, 퀴즈도 함께 삭제됩니다.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
        <button type="button" onClick={() => { onDelete(course); onClose(); }} style={{
          padding: "8px 18px", borderRadius: 10, border: "none",
          background: "var(--color-danger)", color: "var(--color-on-brand)", cursor: "pointer", fontSize: 14, fontWeight: 700
        }}>삭제</button>
      </div>
    </Card>
  </div>
);

const CourseDetailModal = ({
  course,
  onClose,
  onGoSummary,
  onGoQuiz,
  onOpenMaterial,
  onMaterialDeleted,
}: CourseDetailModalProps) => {
  const { showToast } = useToast();
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 자료 삭제 확인 모달 대상과 진행·오류 상태. 요약 페이지와 같은 모달을 공유한다.
  const [pendingDelete, setPendingDelete] = useState<CourseMaterial | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let ignore = false;
    const loadCourseDetail = async () => {
      setLoading(true);
      setError("");
      try {
        const [nextMaterials, nextSummaries, nextQuizSets] = await Promise.all([
          loadCourseMaterialsFromServer(course),
          loadSummariesFromServer(course),
          loadQuizSetsFromServer(course),
        ]);
        if (ignore) return;
        setMaterials(nextMaterials);
        setSummaries(nextSummaries);
        setQuizSets(nextQuizSets);
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

  const emptyText = loading ? "불러오는 중..." : "아직 자료가 없습니다";
  const summaryCountFor = (materialId: string) => summaries.filter(s => s.materialIds?.includes(materialId)).length;
  const quizCountFor = (materialId: string) => quizSets.filter(q => q.materialIds?.includes(materialId)).length;

  // 삭제 버튼은 바로 지우지 않고 확인 모달을 연다(Storage 원본까지 지워져 복구 불가).
  const requestDelete = (material: CourseMaterial) => {
    setDeleteError("");
    setPendingDelete(material);
  };
  const closeDelete = () => {
    if (deleteBusy) return; // 삭제 진행 중에는 닫지 않는다.
    setPendingDelete(null);
    setDeleteError("");
  };
  const confirmDelete = async () => {
    const material = pendingDelete;
    if (!material) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      // 자료 본체와 파생 데이터(요약·튜터 대화·원본 파일)를 한 번에 정리한다. 퀴즈는 남는다.
      await deleteCourseMaterialFromServer(course, material.id);
      setMaterials(prev => prev.filter(item => item.id !== material.id));
      // 자료와 함께 지워진 요약을 빼 "요약 N" 배지를 맞춘다.
      setSummaries(prev => prev.filter(summary => !summary.materialIds?.includes(material.id)));
      setPendingDelete(null);
      showToast("자료를 삭제했어요.", "info");
      onMaterialDeleted?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "강의자료 삭제에 실패했습니다.");
    } finally {
      setDeleteBusy(false);
    }
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
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 850, color: "var(--color-text-strong)" }}>{course}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>강의자료 목록입니다. 자료를 눌러 상세를 보거나, 아래 버튼으로 새 요약·퀴즈를 만드세요.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* 자료 목록에서 바로 강의 자료를 추가(요약 생성 화면으로 이동)할 수 있게 닫기 버튼 왼쪽에 둔다(이슈 #65). */}
            <button type="button" className="tongkk-hover-dim" onClick={onGoSummary} aria-label="강의 자료 추가" style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 9,
              border: "none",
              background: PINK,
              color: "var(--color-on-brand)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 800,
              lineHeight: "32px",
              whiteSpace: "nowrap",
              boxShadow: "0 6px 16px rgba(240,112,174,0.22)",
            }}>+ 자료 추가</button>
            <button type="button" className="tongkk-hover-dim" onClick={onClose} aria-label="강의 상세 닫기" style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: "none",
              background: "var(--color-surface)",
              color: "var(--color-muted)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: "32px",
              padding: 0,
              flexShrink: 0,
            }}>×</button>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "var(--color-tint-pink)", color: "var(--color-danger)", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ border: "1px solid var(--color-border-soft)", borderRadius: 14, background: "var(--color-card)", minHeight: 320, padding: 18 }}>
          {materials.length === 0 ? (
            <div style={{ minHeight: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>{emptyText}</p>
              {!loading && (
                <button type="button" onClick={onGoSummary} style={{
                  padding: "11px 18px", borderRadius: 10, border: "none", background: PINK,
                  color: "var(--color-on-brand)", fontSize: 14, fontWeight: 850, cursor: "pointer",
                  boxShadow: "0 10px 24px rgba(240,112,174,0.22)",
                }}>+ 자료 추가하기</button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {materials.map((material, index) => {
                const summaryCount = summaryCountFor(material.id);
                const quizCount = quizCountFor(material.id);
                return (
                  // 행 전체는 상세 이동 버튼, 오른쪽 ×는 삭제 버튼. 버튼 안에 버튼을 넣을 수 없어 div로 감싼다.
                  <div
                    key={material.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      borderBottom: index < materials.length - 1 ? "1px solid var(--color-border-soft)" : "none",
                    }}
                  >
                    <button
                      type="button"
                      className="tongkk-hover-row"
                      onClick={() => onOpenMaterial(material, summaryCount > 0 ? "summary" : "original")}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "14px 0",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ minWidth: 0, fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)", lineHeight: 1.45, wordBreak: "break-word" }}>
                          {material.name}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}>
                          {materialMeta(material)}
                        </span>
                      </span>
                      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontWeight: 800 }}>
                        <span style={{ color: summaryCount > 0 ? PINK : "var(--color-muted)" }}>요약 {summaryCount}</span>
                        <span style={{ color: quizCount > 0 ? CYAN : "var(--color-muted)" }}>퀴즈 {quizCount}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete(material)}
                      aria-label={`${material.name} 삭제`}
                      title="삭제"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: `1px solid ${BORDER_COLOR}`,
                        background: "var(--color-card)",
                        color: "var(--color-muted)",
                        cursor: "pointer",
                        fontSize: 16,
                        lineHeight: "24px",
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onGoSummary} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "var(--color-tint-pink)",
            color: PINK,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>요약 새로 생성</button>
          <button type="button" onClick={onGoQuiz} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "var(--color-tint-cyan)",
            color: CYAN,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>퀴즈 새로 생성</button>
        </div>
      </Card>
      {pendingDelete && (
        <MaterialDeleteConfirmModal
          materialName={pendingDelete.name}
          summaryCount={summaryCountFor(pendingDelete.id)}
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDelete}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

// 공지사항 — 백엔드 공지 테이블이 아직 없어 정적으로 관리한다. 새 공지는 이 배열에 추가하면 된다.
// link/linkLabel이 있으면 카드 하단에 바로가기 버튼이 표시된다(예: 설문 구글폼).
const NOTICES: { date: string; tag: string; title: string; body: string; link?: string; linkLabel?: string }[] = [
  {
    date: "2026.06.11",
    tag: "설문",
    title: "사용자 설문에 참여해 주세요",
    body: "더 나은 Tongkk을 만들기 위해 짧은 설문을 준비했어요. 잠깐이면 끝나니 아래 버튼으로 참여해 주시면 큰 도움이 됩니다.",
    link: "https://forms.gle/cDguG46mLHqSUmu7A",
    linkLabel: "설문 참여하기",
  },
  {
    date: "2026.06.11",
    tag: "안내",
    title: "Tongkk 베타 오픈",
    body: "현재 캡스톤 시연용 MVP 단계예요. 일부 기능이 불완전하거나 오류가 있을 수 있습니다.",
  },
  {
    date: "2026.06.11",
    tag: "개발 중",
    title: "아직 준비 중인 기능이 있어요",
    body: "다음 기능은 아직 완성되지 않았어요: 다크모드(완벽 적용 전), AI 학습 계획 자동 생성, 학습 통계 탭, 로그인 기능. 순차적으로 업데이트할 예정이니 양해 부탁드려요.",
  },
  {
    date: "2026.06.11",
    tag: "피드백",
    title: "여러분의 의견을 기다립니다",
    body: `사이드바 하단의 '피드백 보내기' 또는 ${FEEDBACK_EMAIL}로 의견을 보내주시면 큰 힘이 됩니다.`,
  },
];

const NoticeModal = ({ onClose }: { onClose: () => void }) => (
  <div onClick={onClose} style={{
    position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.24)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
  }}>
    <Card onClick={e => e.stopPropagation()} style={{ width: "min(460px, 100%)", maxHeight: "calc(100vh - 56px)", overflowY: "auto", padding: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>공지사항</h3>
        <button type="button" className="tongkk-hover-dim" onClick={onClose} aria-label="공지사항 닫기" style={{
          width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--color-surface)",
          color: "var(--color-muted)", cursor: "pointer", fontSize: 18, lineHeight: "30px",
        }}>×</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {NOTICES.map((notice, i) => (
          <div key={i} style={{ padding: 16, borderRadius: 12, border: `1px solid ${BORDER_COLOR}`, background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--color-tint-pink)", color: PINK, fontSize: 11, fontWeight: 800 }}>{notice.tag}</span>
              <span style={{ fontSize: 12, color: "var(--color-muted)", fontWeight: 700 }}>{notice.date}</span>
            </div>
            <p style={{ margin: "0 0 5px", fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)" }}>{notice.title}</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{notice.body}</p>
            {notice.link && (
              <a
                href={notice.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12,
                  padding: "9px 16px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)",
                  fontSize: 13, fontWeight: 800, textDecoration: "none", cursor: "pointer",
                }}
              >
                {notice.linkLabel || "바로가기"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7" />
                  <path d="M8 7h9v9" />
                </svg>
              </a>
            )}
          </div>
        ))}
      </div>
    </Card>
  </div>
);

// 피드백 보내기 — 메일 주소를 보여주고, mailto로 바로 메일을 보낼 수 있게 한다.
// 메일 클라이언트가 없는 사용자를 위해 주소 복사 버튼도 함께 둔다.
const FeedbackModal = ({ onClose }: { onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.24)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <Card onClick={e => e.stopPropagation()} style={{ width: "min(400px, 100%)", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>피드백 보내기</h3>
          <button type="button" className="tongkk-hover-dim" onClick={onClose} aria-label="피드백 창 닫기" style={{
            width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--color-surface)",
            color: "var(--color-muted)", cursor: "pointer", fontSize: 18, lineHeight: "30px",
          }}>×</button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
          버그 제보, 기능 제안 등 어떤 의견이든 환영해요. 아래 주소로 메일을 보내주시면 큰 힘이 됩니다.
        </p>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`,
          background: "var(--color-surface)", marginBottom: 14,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-strong)", wordBreak: "break-all" }}>{FEEDBACK_EMAIL}</span>
          <button type="button"
            onClick={() => {
              navigator.clipboard?.writeText(FEEDBACK_EMAIL).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            style={{
              flexShrink: 0, padding: "6px 12px", borderRadius: 8, border: `1px solid ${BORDER_COLOR}`,
              background: "var(--color-card)", color: copied ? CYAN : "var(--color-text-secondary)",
              fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >{copied ? "복사됨!" : "복사"}</button>
        </div>
        <a
          href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Tongkk 피드백")}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "12px 16px", borderRadius: 10, border: "none",
            background: PINK, color: "var(--color-on-brand)",
            fontSize: 14, fontWeight: 800, textDecoration: "none", cursor: "pointer",
            boxShadow: "0 10px 24px rgba(240,112,174,0.22)",
          }}
        >
          <PaperPlaneIcon />
          메일 보내기
        </a>
      </Card>
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { requireAuth } = useAuthGate();
  const { courses, addCourse, renameCourse, deleteCourse, hasLoadedCourses } = useCourses();
  const { showToast } = useToast();
  const { ready: readyTutorial } = useTutorial();
  const { openSampleDemo } = useSampleDemo();
  const [sidebar, setSidebar] = useState(false);

  // 강의 목록 로딩이 끝난 뒤에 대시보드 튜토리얼을 띄운다(스켈레톤 위 노출 방지).
  useEffect(() => {
    if (hasLoadedCourses) readyTutorial("dashboard");
  }, [hasLoadedCourses, readyTutorial]);
  const [showNotice, setShowNotice] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
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
  // AI 생성 직전의 계획 스냅샷. 있으면 "되돌리기" 버튼을 노출한다.
  const [planUndoSnapshot, setPlanUndoSnapshot] = useState<{ plans: Plan[]; message: string } | null>(null);
  // 콜드 스타트 대응: 학습 기록이 없어도 좋은 계획이 나오도록 사용자가 알려주는 학습 상태.
  const [studyPlanGoal, setStudyPlanGoal] = useState<StudyPlanGoal>("exam");
  const [studyPlanFamiliarity, setStudyPlanFamiliarity] = useState<StudyPlanFamiliarity>("attended");
  const [studyPlanDailyMinutes, setStudyPlanDailyMinutes] = useState(60);
  // 미완료 이월: 항목을 일일이 고르게 하지 않고 토글 하나로 전부 반영/제외한다.
  const [includeCarryover, setIncludeCarryover] = useState(true);
  const [editingPlanKey, setEditingPlanKey] = useState<string | null>(null);
  const [editingPlanText, setEditingPlanText] = useState("");
  const [openCourseMenu, setOpenCourseMenu] = useState<string | null>(null);
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<string | null>(null);
  const [detailCourse, setDetailCourse] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<CourseDetailSection | undefined>(undefined);
  const [courseStats, setCourseStats] = useState<Record<string, CourseStats>>({});
  // "자료 복습하기" 클릭 후 요약 목록 조회 중 중복 클릭 방지.
  const [reviewNavigating, setReviewNavigating] = useState(false);
  // 페이스 플랜은 학습 캘린더에서 관리한다. 대시보드는 "오늘 추천 과목" 계산을 위해 읽기 전용으로만 로드.
  const [pacePlans, setPacePlans] = useState<PacePlan[]>([]);
  // 퀴즈 기준 플랜의 진행도를 파생 계산하기 위한 과목별 응시 기록 {count, createdAt}.
  const [courseQuizAttempts, setCourseQuizAttempts] = useState<Record<string, { count: number; createdAt: number; scorePercent: number }[]>>({});

  useEffect(() => {
    let ignore = false;
    if (courses.length === 0) {
      setCourseStats({});
      return () => { ignore = true; };
    }
    setCourseStats(prev => {
      const next: Record<string, CourseStats> = {};
      courses.forEach(course => { next[course] = prev[course] || { ...defaultStats }; });
      return next;
    });
    const loadStats = async () => {
      await Promise.all(courses.map(async course => {
        try {
          // 자료/요약/퀴즈는 개수만 필요하므로 행 본문을 받지 않고 Supabase count(head)만 조회한다.
          const [materials, summaries, quizzes] = await Promise.all([
            countCourseMaterialsFromServer(course),
            countSummariesFromServer(course),
            countQuizSetsFromServer(course),
          ]);
          if (ignore) return;
          setCourseStats(prev => ({ ...prev, [course]: { materials, summaries, quizzes, loading: false, error: "" } }));
        } catch (err) {
          if (ignore) return;
          setCourseStats(prev => ({ ...prev, [course]: { ...(prev[course] || defaultStats), loading: false, error: err instanceof Error ? err.message : "오류" } }));
        }
      }));
    };
    void loadStats();
    return () => { ignore = true; };
  }, [courses]);

  const openCourseDetail = (course: string, section?: CourseDetailSection) => {
    setDetailSection(section);
    setDetailCourse(course);
  };

  // 해당 과목의 자료 업로드 화면으로 바로 이동한다. 대시보드 카드/모달의 자료 추가
  // 동선이 모두 이 한 곳을 거치게 해, 추후 분해 시 네비게이션 계약을 한 군데서 유지한다.
  const goUploadForCourse = (course: string) => {
    if (!requireAuth("강의 자료를 추가하려면 로그인이 필요해요")) return;
    navigate(pageRoutes["자료 요약"], { state: { selectedCourse: course, fromDashboard: true } });
  };

  // 자료 삭제 등으로 개수가 바뀐 과목의 통계만 다시 받는다(서비스 계층이 캐시를 무효화해 둔 상태).
  const refreshCourseStats = async (course: string) => {
    try {
      const [materials, summaries, quizzes] = await Promise.all([
        countCourseMaterialsFromServer(course),
        countSummariesFromServer(course),
        countQuizSetsFromServer(course),
      ]);
      setCourseStats(prev => ({ ...prev, [course]: { materials, summaries, quizzes, loading: false, error: "" } }));
    } catch {
      // 통계 갱신 실패는 치명적이지 않다. 다음 대시보드 로드에서 다시 맞춰진다.
    }
  };

  useEffect(() => {
    let ignore = false;
    // 게스트(또는 세션 만료)면 서버 호출 없이 빈 상태로 — user가 deps에 있어 로그인 시 자동 재로딩.
    if (!user) {
      setDdays([]);
      setPlans([]);
      setDashboardStateLoaded(false);
      return () => {
        ignore = true;
      };
    }
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
  }, [user]);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("ddays", ddays).catch(console.warn);
  }, [dashboardStateLoaded, ddays]);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("plans", plans).catch(console.warn);
  }, [dashboardStateLoaded, plans]);

  useEffect(() => {
    let ignore = false;
    if (!user) {
      setPacePlans([]);
      return () => { ignore = true; };
    }
    loadDashboardState<PacePlan[]>("pacePlans", [])
      .then(next => {
        if (ignore) return;
        setPacePlans(next);
      })
      .catch(error => console.warn("페이스 플랜 불러오기 실패", error));
    return () => { ignore = true; };
  }, [user]);

  // 응시 기록 로드: 페이스 플랜 진행도·준비도 계산 + 간격 반복 복습 추천 + AI 계획 컨텍스트에 사용.
  // 과목 집합이 바뀔 때만 재조회하도록 안정 키에 의존(수동 플랜 변경 시 불필요한 재조회 방지).
  const paceCoursesKey = JSON.stringify(
    Array.from(new Set([...pacePlans.map(plan => plan.course), ...courses])).sort()
  );
  useEffect(() => {
    const paceCourses: string[] = JSON.parse(paceCoursesKey);
    if (paceCourses.length === 0) { setCourseQuizAttempts({}); return; }
    let ignore = false;
    Promise.all(paceCourses.map(async course => {
      const attempts = await loadQuizAttemptsFromServer(course);
      const mapped = attempts
        .map(attempt => ({ count: attempt.count, createdAt: attempt.createdAt, scorePercent: attempt.scorePercent }))
        .sort((a, b) => b.createdAt - a.createdAt); // 최근 응시가 앞 — 준비도 가중치(최근일수록 ↑)용
      return [course, mapped] as const;
    }))
      .then(entries => { if (!ignore) setCourseQuizAttempts(Object.fromEntries(entries)); })
      .catch(error => console.warn("페이스 퀴즈 진행 불러오기 실패", error));
    return () => { ignore = true; };
  }, [paceCoursesKey]);


  useEffect(() => {
    if (!openCourseMenu) return;
    const closeMenu = () => setOpenCourseMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openCourseMenu]);

  const sortedDdays = [...ddays].sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
  const displayDdays = showAllDdays ? sortedDdays : sortedDdays.slice(0, 3);
  // 이월 후보: 오늘까지의 미완료 항목만(시험 대비로 미래 날짜에 배치된 항목은 밀린 게 아니므로 제외).
  const todayKey = paceDateKey(new Date());
  const incompletePlans = plans.filter(plan => !plan.done && (!plan.date || plan.date <= todayKey));
  const makeDdaySourceKey = (dday: Dday, index: number) => `dday-${dday.id || `${dday.subj}-${dday.date}-${index}`}`;
  // 간격 반복 복습 후보: 과목별 최근 응시가 1~7일 전이면 다시 꺼내 인출 연습을 제안한다.
  const reviewCandidates = Object.entries(courseQuizAttempts).flatMap(([course, attempts]) => {
    const latest = attempts[0];
    if (!latest) return [];
    const daysSince = Math.floor((Date.now() - latest.createdAt) / 86400000);
    if (daysSince < 1 || daysSince > 7) return [];
    return [{ course, daysSince, scorePercent: Math.round(latest.scorePercent) }];
  });
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
    ...reviewCandidates.map(candidate => ({
      key: `review-${candidate.course}`,
      label: candidate.course,
      meta: `${candidate.daysSince}일 전 퀴즈 ${candidate.scorePercent}점`,
      kind: "review" as const,
      review: candidate,
    })),
  ];
  const canGenerateStudyPlan = planSources.length > 0 || incompletePlans.length > 0;
  const selectedPlanSources = planSources.filter(source => selectedPlanSourceKeys.includes(source.key));
  const reviewPlanSources = planSources.filter(source => source.kind === "review");
  const ddayPlanSources = planSources.filter(source => source.kind !== "review");
  // 소스 칩을 하나도 안 골라도 이월 토글만 켜져 있으면 생성 가능.
  const canSubmitPlan = selectedPlanSources.length > 0 || (includeCarryover && incompletePlans.length > 0);

  const summarizePlanSources = (sources: PlanSource[], mode: StudyPlanMode, carryoverCount: number) => {
    const assignmentCount = sources.filter(source => source.kind === "assignment").length;
    const examCount = sources.filter(source => source.kind === "exam").length;
    const eventCount = sources.filter(source => source.kind === "event").length;
    const reviewCount = sources.filter(source => source.kind === "review").length;
    const parts = [
      carryoverCount ? `미완료 계획 ${carryoverCount}개` : "",
      assignmentCount ? `가까운 과제 ${assignmentCount}개` : "",
      examCount ? `가까운 시험 ${examCount}개` : "",
      eventCount ? `가까운 일정 ${eventCount}개` : "",
      reviewCount ? `복습 추천 ${reviewCount}개` : "",
    ].filter(Boolean);
    if (parts.length === 0) return "자동으로 고른 항목이 없어요. 반영할 항목을 선택해 주세요.";
    if (mode === "lighter") return `${parts.join("와 ")}만 가볍게 반영할게요.`;
    if (mode === "harder") return `${parts.join("와 ")}를 조금 빡세게 반영할게요.`;
    if (mode === "assignment") return `과제 중심으로 ${parts.join("와 ")}를 골라뒀어요.`;
    if (mode === "event") return `일정 위주로 ${parts.join("와 ")}를 골라뒀어요.`;
    return `${parts.join("와 ")}를 반영할게요.`;
  };

  const getRecommendedPlanSourceKeys = (mode: StudyPlanMode) => {
    const ddayLimit = mode === "harder" ? 5 : mode === "lighter" ? 1 : 3;
    // 과제·시험은 마감 전 미리 준비하는 "마감형"으로 함께 보고, 일정(event)은 당일 위주로 본다.
    const isDeadlineKind = (kind: PlanSource["kind"]) => kind === "assignment" || kind === "exam";
    const ddaySources = planSources
      .filter(source => {
        const daysLeft = source.daysLeft ?? 999;
        if (mode === "assignment") return source.kind === "assignment" && daysLeft <= 10;
        if (mode === "event") return source.kind === "event" && daysLeft <= 7;
        if (mode === "lighter") return isDeadlineKind(source.kind) ? daysLeft <= 3 : daysLeft <= 1;
        if (mode === "harder") return isDeadlineKind(source.kind) ? daysLeft <= 14 : daysLeft <= 2;
        return isDeadlineKind(source.kind) ? daysLeft <= 7 : daysLeft <= 1;
      })
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, ddayLimit);
    // 간격 반복 복습은 기본 1~2개만 추천(부하를 키우지 않는 선에서).
    const reviewLimit = mode === "harder" ? 3 : mode === "lighter" ? 1 : 2;
    const reviewSources = planSources
      .filter(source => source.kind === "review")
      .sort((a, b) => (b.review?.daysSince ?? 0) - (a.review?.daysSince ?? 0))
      .slice(0, reviewLimit);
    return [...ddaySources, ...reviewSources].map(source => source.key);
  };

  // 진단 퀴즈 대상 과목: 선택한 시험 D-day와 이름이 닿는 과목 → 자료 있는 과목 → 첫 과목 순.
  const diagnosticCourse = (() => {
    const examDday = selectedPlanSources.find(source => source.kind === "exam")?.dday;
    const fromExam = examDday
      ? courses.find(course => examDday.subj.includes(course) || course.includes(examDday.subj))
      : undefined;
    return fromExam ?? courses.find(course => (courseStats[course]?.materials ?? 0) > 0) ?? courses[0];
  })();

  const openPlanSourcePicker = (mode: StudyPlanMode) => {
    if (!requireAuth("AI 학습 계획을 만들려면 로그인이 필요해요")) return;
    if (!canGenerateStudyPlan) return;
    const recommendedKeys = getRecommendedPlanSourceKeys(mode);
    const recommendedSources = planSources.filter(source => recommendedKeys.includes(source.key));
    setPendingStudyPlanMode(mode);
    setSelectedPlanSourceKeys(recommendedKeys);
    setIncludeCarryover(incompletePlans.length > 0);
    setPlanSourceMessage(summarizePlanSources(recommendedSources, mode, incompletePlans.length));
    setStudyPlanError("");
    setShowPlanSourcePicker(true);
  };

  const requestStudyPlan = async () => {
    if (!canSubmitPlan || studyPlanLoading) return;
    setStudyPlanLoading(true);
    setStudyPlanError("");
    try {
      const selectedDdays = selectedPlanSources
        .map(source => source.dday)
        .filter((dday): dday is Dday => Boolean(dday));
      // 이월은 토글 하나로 전부 반영(너무 많으면 최근 8개까지만).
      const carryoverToSend = includeCarryover ? incompletePlans.slice(0, 8) : [];
      const selectedReviews = selectedPlanSources
        .map(source => source.review)
        .filter((review): review is NonNullable<PlanSource["review"]> => Boolean(review));
      // 데이터 기반 처방 근거: 과목별 자료·요약·퀴즈 현황과 최근 응시 기록 요약.
      const courseContexts = courses.map(course => {
        const stats = courseStats[course];
        const attempts = courseQuizAttempts[course] ?? [];
        const latest = attempts[0];
        return {
          name: course,
          materials: stats?.materials ?? 0,
          summaries: stats?.summaries ?? 0,
          quizSets: stats?.quizzes ?? 0,
          attempts: attempts.length,
          lastScorePercent: latest ? Math.round(latest.scorePercent) : null,
          // 최근 3회 응시의 추정 오답 수(문항수 × 오답률 합).
          recentWrongCount: attempts.slice(0, 3).reduce(
            (sum, attempt) => sum + Math.round(attempt.count * (100 - attempt.scorePercent) / 100), 0,
          ),
          daysSinceLastAttempt: latest ? Math.floor((Date.now() - latest.createdAt) / 86400000) : null,
        };
      });
      const result = await generateStudyPlan(selectedDdays, carryoverToSend, pendingStudyPlanMode, {
        goal: studyPlanGoal,
        familiarity: studyPlanFamiliarity,
        dailyMinutes: studyPlanDailyMinutes,
        courses: courseContexts,
        reviewCandidates: selectedReviews.map(review => ({
          course: review.course,
          daysSince: review.daysSince,
          scorePercent: review.scorePercent,
        })),
      });
      // 되돌리기용 스냅샷(생성 직전 상태). 다음 생성 전까지 유지된다.
      setPlanUndoSnapshot({ plans, message: studyPlanMessage });
      setStudyPlanMessage(result.message);
      // 직접 작성한 계획과 완료된 항목은 유지하고,
      // 이전 AI 생성 미완료 항목과 이번에 이월로 넘긴 미완료 항목만 새 AI 계획으로 교체한다.
      const replacedIds = new Set(carryoverToSend.map(plan => plan.id).filter(Boolean));
      const replacedRefs = new Set<Plan>(carryoverToSend);
      setPlans(prev => [
        ...prev.filter(item => {
          if (replacedRefs.has(item) || (item.id && replacedIds.has(item.id))) return false;
          if (item.origin === "ai" && !item.done) return false;
          return true;
        }),
        ...result.items.map(item => ({
          id: createClientId(),
          text: `${item.text} ${item.minutes}분`,
          done: false,
          minutes: item.minutes,
          sourceType: item.sourceType,
          origin: "ai" as const,
          action: item.action ?? undefined,
          course: item.course ?? undefined,
          // 시험 분산 배치: 오늘(0)은 date 없이(레거시 호환), 이후 날짜는 캘린더에 깔린다.
          date: item.dayOffset > 0 ? paceDateKey(new Date(Date.now() + item.dayOffset * 86400000)) : undefined,
        })),
      ]);
      setShowPlanSourcePicker(false);
    } catch (err) {
      setStudyPlanError(err instanceof Error ? err.message : "학습 계획 생성 실패");
    } finally {
      setStudyPlanLoading(false);
    }
  };

  // AI 계획 항목의 딥링크: 클릭 한 번으로 해당 학습 화면에 진입시켜 실행 마찰을 줄인다.
  const planActionLabels: Record<PlanAction, string> = {
    retry_quiz: "퀴즈 다시 풀기",
    review_wrong: "오답 확인하기",
    review_summary: "요약 복습하기",
    read_material: "자료 보기",
    make_quiz: "퀴즈 만들기",
  };
  // LLM이 적은 과목명을 실제 과목으로 정규화(정확 일치 → 부분 일치).
  const resolvePlanCourse = (name?: string) => {
    if (!name) return undefined;
    return courses.find(course => course === name)
      ?? courses.find(course => course.includes(name) || name.includes(course));
  };
  const openPlanAction = (plan: Plan) => {
    if (!plan.action) return;
    if (plan.action === "review_wrong") {
      navigate(pageRoutes["오답 노트"]);
      return;
    }
    // 퀴즈/요약 페이지는 과목 핸드오프 없이 진입하면 대시보드로 돌아오므로 과목이 풀릴 때만 이동.
    const course = resolvePlanCourse(plan.course);
    if (!course) return;
    if (plan.action === "retry_quiz" || plan.action === "make_quiz") {
      navigate(pageRoutes["퀴즈 생성"], { state: { course, fromDashboard: true } });
      return;
    }
    navigate(pageRoutes["자료 요약"], { state: { selectedCourse: course, fromDashboard: true } });
  };

  const undoStudyPlan = () => {
    if (!planUndoSnapshot) return;
    setPlans(planUndoSnapshot.plans);
    setStudyPlanMessage(planUndoSnapshot.message);
    setPlanUndoSnapshot(null);
  };

  const deleteDday = (target: Dday) => {
    setDdays(prev => {
      if (target.id) return prev.filter(item => item.id !== target.id);
      const targetIndex = prev.findIndex(item => item.subj === target.subj && item.date === target.date);
      if (targetIndex < 0) return prev;
      return prev.filter((_, index) => index !== targetIndex);
    });
  };

  // 계획 삭제는 확인 모달 대신 토스트의 "되돌리기"로 복구를 보장한다(흐름을 끊지 않으면서 실수 방어).
  const deletePlan = (target: Plan, targetIndex: number) => {
    const removeIndex = target.id ? plans.findIndex(item => item.id === target.id) : targetIndex;
    if (removeIndex < 0) return;
    const removed = plans[removeIndex];
    setPlans(prev => prev.filter((item, index) =>
      removed.id ? item.id !== removed.id : index !== removeIndex
    ));
    showToast("학습 계획을 삭제했어요.", "info", {
      duration: 6000,
      action: {
        label: "되돌리기",
        onAction: () => setPlans(current => {
          if (removed.id && current.some(item => item.id === removed.id)) return current;
          const next = [...current];
          next.splice(Math.min(removeIndex, next.length), 0, removed);
          return next;
        }),
      },
    });
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

  const pacePlanViews = pacePlans.map(plan => {
    const dday = ddays.find(item => item.id === plan.ddayId);
    const daysLeft = dday ? getDaysLeft(dday.date) : PACE_NO_DDAY_HORIZON_DAYS;
    // 퀴즈 기준 플랜은 생성 이후 같은 과목 응시 문항수를 진행도로 파생, 그 외는 저장된 doneUnits 사용.
    const auto = plan.basis === "quiz";
    const attempts = courseQuizAttempts[plan.course] ?? [];
    const autoDone = auto
      ? attempts
          .filter(attempt => attempt.createdAt >= plan.createdAt)
          .reduce((sum, attempt) => sum + attempt.count, 0)
      : 0;
    const doneUnits = auto ? Math.min(plan.totalUnits, autoDone) : plan.doneUnits;
    const view: PacePlan = { ...plan, doneUnits };
    const status: PaceStatus = dday ? paceStatus(view, dday.date) : "on";
    // 따라잡기: 연결된 D-day가 있으면 밀린 만큼 오늘 목표를 올려준다(없으면 기본 목표).
    const todayTarget = dday ? paceCatchUpTarget(view, dday.date, daysLeft) : paceTodayTarget(view, daysLeft);
    // 시험 준비도: 진도 + 최근 퀴즈 점수(없으면 진도로 대체). 막판 스퍼트: 연결 D-day가 D-3 이내.
    const readiness = paceReadiness(view, attempts.map(attempt => attempt.scorePercent));
    const sprint = dday ? isPaceSprint(daysLeft) : false;
    return {
      plan,
      dday,
      daysLeft,
      status,
      auto,
      doneUnits,
      totalUnits: plan.totalUnits,
      unitLabel: plan.unitLabel ?? "개",
      remaining: paceRemaining(view),
      progress: paceProgressPct(view),
      todayTarget,
      readiness,
      tier: readinessTier(readiness),
      hasScores: attempts.length > 0,
      sprint,
    };
  });
  const activePaceViews = pacePlanViews.filter(view => view.remaining > 0);
  const todayStr = paceDateKey(new Date());
  // 오늘의 학습계획에는 날짜가 없거나(레거시=오늘) 오늘인 항목만 노출, 나머지는 캘린더에서.
  const todayPlanEntries = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.date || plan.date === todayStr);
  const statusRank: Record<PaceStatus, number> = { behind: 0, slightly: 1, on: 2 };
  // 오늘 바로 시작할 추천 과목 — 가장 급한(밀린·임박) 진행 중 플랜 하나.
  const stepView = [...activePaceViews]
    .sort((a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      a.daysLeft - b.daysLeft ||
      a.progress - b.progress
    )[0] ?? null;
  const recommendedCourse = stepView?.plan.course ?? null;
  const startHint = !stepView
    ? "추천할 과목이 아직 없어요."
    : stepView.status !== "on"
      ? `조금 밀렸어요. ${stepView.plan.course}부터 시작해요.`
      : stepView.dday
        ? `오늘 추천: ${stepView.plan.course} · ${formatDdayLabel(stepView.daysLeft)}`
        : `오늘 추천: ${stepView.plan.course}`;
  // "자료 복습하기" 대상 과목: 추천 과목 → 요약 있는 과목 → 자료 있는 과목 순.
  // (페이스 플랜이 없어도 복습 동선이 끊기지 않게 한다.)
  const reviewCourse = recommendedCourse
    ?? courses.find(course => (courseStats[course]?.summaries ?? 0) > 0)
    ?? courses.find(course => (courseStats[course]?.materials ?? 0) > 0)
    ?? null;

  // "자료 복습하기"는 라벨대로 '보러' 간다: 가장 최근 요약이 달린 자료 상세(요약 탭)로
  // 바로 이동하고, 과목에 요약이 아직 없으면 요약 설정 화면으로 폴백한다.
  const handleReviewMaterials = async () => {
    if (!reviewCourse || reviewNavigating) return;
    setReviewNavigating(true);
    const fallbackState = { selectedCourse: reviewCourse, fromDashboard: true };
    try {
      const summaries = await loadSummariesFromServer(reviewCourse);
      const latest = [...summaries]
        .sort((a, b) => b.createdAt - a.createdAt)
        .find(summary => (summary.materialIds || []).length > 0);
      if (latest?.materialIds?.length) {
        navigate(pageRoutes["자료 요약"], {
          state: {
            ...fallbackState,
            viewMaterial: true,
            materialId: latest.materialIds[0],
            materialIds: latest.materialIds,
            materialDetailTab: "summary" as const,
          },
        });
        return;
      }
      navigate(pageRoutes["자료 요약"], { state: fallbackState });
    } catch {
      // 요약 조회가 실패해도 동선은 끊지 않는다 — 기존처럼 과목의 요약 화면으로 보낸다.
      navigate(pageRoutes["자료 요약"], { state: fallbackState });
    } finally {
      setReviewNavigating(false);
    }
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {showAddCourse && (
        <AddCourseModal
          onClose={() => setShowAddCourse(false)}
          onAdd={addCourse}
          onAddAndUpload={name => {
            addCourse(name);
            goUploadForCourse(name);
          }}
        />
      )}
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
          onOpenMaterial={(material, initialTab) => {
            navigate(pageRoutes["자료 요약"], {
              state: { selectedCourse: detailCourse, materialId: material.id, viewMaterial: true, materialDetailTab: initialTab, fromDashboard: true },
            });
          }}
          onMaterialDeleted={() => { void refreshCourseStats(detailCourse); }}
        />
      )}
      {showAddDday && <AddDdayModal onClose={() => setShowAddDday(false)} onAdd={(type, s, d) => setDdays(prev => [...prev, { id: createClientId(), type, subj: s, date: d }])} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={t => setPlans(prev => [...prev, { id: createClientId(), text: t, done: false }])} />}
      {showNotice && <NoticeModal onClose={() => setShowNotice(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid var(--color-border-soft)" }}>
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(true)} aria-label="메뉴 열기" style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="tongkk-hover-fade" onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <NoticeBanner messages={[
          { text: "⭐️ Tongkk 베타 오픈 ⭐️ ", color: PINK },
          "일부 기능이 불완전하거나 오류가 있을 수 있습니다. ",
          "Tongkk는 무료! 사용료 대신 여러분의 피드백을 먹고 자랍니다 ^.^ ",
          "더 나은 Tongkk을 만들기 위해 짧은 설문을 준비했으니 오른쪽 공지사항을 참고해주세요."
,
        ]} />
        <button type="button"
          className="tongkk-hover-dim"
          onClick={() => setShowNotice(true)}
          aria-label="공지사항"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`,
            background: "var(--color-card)", color: "var(--color-text-secondary)",
            fontSize: 13.5, fontWeight: 700, cursor: "pointer",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <span className="header-btn-label">공지사항</span>
        </button>
        <button type="button"
          className="tongkk-hover-dim"
          onClick={() => setShowFeedback(true)}
          aria-label="피드백 보내기"
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`,
            background: "var(--color-card)", color: "var(--color-text-secondary)",
            fontSize: 13.5, fontWeight: 700, cursor: "pointer",
          }}
        >
          <PaperPlaneIcon />
          <span className="header-btn-label">피드백 보내기</span>
        </button>
        <TutorialHelpButton tutorialKey="dashboard" />
      </div>

      <div className="app-container">
        <Card className="mb-5 border border-cyan/30 bg-cyan/5 p-5">
          <h2 className="m-0 text-xl font-extrabold leading-7 text-text-strong">
            공부 시작하기
          </h2>
          <p className="m-0 mt-2 text-sm font-bold leading-5 text-muted">
            {startHint}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate(pageRoutes["오답 노트"])}
              className="flex flex-col items-start gap-1 rounded-[14px] border border-pink bg-white px-5 py-4 text-left cursor-pointer hover:bg-pink/5 dark:bg-slate-900"
            >
              <span className="text-base font-extrabold text-pink">오답 다시 풀기</span>
              <span className="text-xs font-semibold text-pink/80">틀린 문제부터 확인</span>
            </button>
            <button
              type="button"
              onClick={() => void handleReviewMaterials()}
              disabled={!reviewCourse}
              className={reviewCourse
                ? "flex flex-col items-start gap-1 rounded-[14px] border border-cyan bg-white px-5 py-4 text-left cursor-pointer hover:bg-cyan/5 dark:bg-slate-900"
                : "flex flex-col items-start gap-1 rounded-[14px] border border-cyan/40 bg-white px-5 py-4 text-left cursor-default opacity-60 dark:bg-slate-900"}
            >
              <span className="text-base font-extrabold text-cyan">자료 복습하기</span>
              <span className="text-xs font-semibold text-cyan/80">
                {!reviewCourse
                  ? "과목과 자료를 먼저 추가해보세요"
                  : (courseStats[reviewCourse]?.summaries ?? 0) > 0
                    ? `${reviewCourse} 최근 요약 보기`
                    : `${reviewCourse} 요약 만들러 가기`}
              </span>
            </button>
          </div>
        </Card>
        <div className="dash-main-grid">
          {/* 강의 목록 카드 그리드 */}
          <div>
            {!hasLoadedCourses ? (
              /* 첫 동기화 전에는 빈 상태 대신 스켈레톤 — 재진입 시 "강의가 없습니다"가
                 깜빡여 데이터가 사라진 것처럼 보이는 문제를 막는다. */
              <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                {[0, 1, 2].map(i => (
                  <Card key={i} style={{ minHeight: 120, padding: 20 }}>
                    <div className="tongkk-skeleton-block" style={{ width: "55%", height: 18, marginBottom: 12 }} />
                    <div className="tongkk-skeleton-block" style={{ width: "75%", height: 13 }} />
                  </Card>
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div style={{
                minHeight: 300, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--color-text-secondary)",
              }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 850, color: "var(--color-text-strong)" }}>아직 등록된 강의가 없습니다.</h2>
                <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.7, color: "var(--color-muted)" }}>
                  강의를 만들고 강의자료를 올려보세요.<br />AI가 요약·퀴즈·학습 계획까지 한 번에 도와드려요.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                  <button type="button" onClick={() => { if (!requireAuth("강의를 추가하려면 로그인이 필요해요")) return; setShowAddCourse(true); }} style={{
                    padding: "11px 18px", borderRadius: 10, border: "none", background: PINK,
                    color: "var(--color-on-brand)", fontSize: 14, fontWeight: 850, cursor: "pointer",
                    boxShadow: "0 10px 24px rgba(240,112,174,0.22)",
                  }}>+ 강의 추가하기</button>
                  <button type="button" onClick={openSampleDemo} style={{
                    padding: "11px 18px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`, background: "transparent",
                    color: "var(--color-text-secondary)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}>예시로 둘러보기</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                {courses.map(course => {
                  const stats = courseStats[course] || defaultStats;
                  const statsLabel = stats.loading
                    ? "자료 - · 요약 - · 퀴즈 -"
                    : `자료 ${stats.materials} · 요약 ${stats.summaries} · 퀴즈 ${stats.quizzes}`;
                  return (
                    <Card
                      key={course}
                      className="tongkk-hover-lift"
                      role="button"
                      tabIndex={0}
                      onClick={() => openCourseDetail(course)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCourseDetail(course); } }}
                      style={{
                        minHeight: 120, padding: 20, cursor: "pointer", position: "relative",
                        display: "flex", flexDirection: "column", justifyContent: "space-between",
                        transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      }}
                    >
                      <div>
                        <h2 style={{ margin: "0 44px 10px 0", fontSize: 17, fontWeight: 850, color: "var(--color-text-strong)", lineHeight: 1.35, wordBreak: "break-word" }}>
                          {course}
                        </h2>
                        <p style={{ margin: 0, fontSize: 13, color: stats.error ? "var(--color-danger)" : "var(--color-text-secondary)", fontWeight: 700 }}>
                          {stats.error ? "정보를 불러오지 못했습니다" : statsLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="tongkk-hover-dim"
                        aria-label={`${course} 관리 메뉴`}
                        onClick={e => { e.stopPropagation(); setOpenCourseMenu(prev => prev === course ? null : course); }}
                        style={{
                          // 모바일 터치를 고려해 히트 영역을 38px 이상으로 유지한다.
                          position: "absolute", top: 10, right: 10,
                          width: 38, height: 38, borderRadius: 10, border: "1px solid var(--color-border-soft)",
                          background: openCourseMenu === course ? "var(--color-surface)" : "var(--color-card)",
                          color: "var(--color-muted)", cursor: "pointer", fontSize: 18, lineHeight: "34px", padding: 0,
                        }}
                      >...</button>
                      {openCourseMenu === course && (
                        <div onClick={e => e.stopPropagation()} style={{
                          position: "absolute", right: 10, top: 52, width: 128, padding: 6,
                          borderRadius: 12, border: "1px solid var(--color-border-soft)", background: "var(--color-card)",
                          boxShadow: "0 12px 28px rgba(0,0,0,0.12)", zIndex: 20,
                        }}>
                          <button type="button" className="tongkk-hover-row" onClick={() => { setOpenCourseMenu(null); goUploadForCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "var(--color-card)", color: "var(--color-text-strong)", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}>자료 추가</button>
                          <button type="button" className="tongkk-hover-row" onClick={() => { setOpenCourseMenu(null); setRenamingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "var(--color-card)", color: "var(--color-text-strong)", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}>이름 변경</button>
                          <button type="button" className="tongkk-hover-row" onClick={() => { setOpenCourseMenu(null); setDeletingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "var(--color-card)", color: "var(--color-danger)", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 700 }}>삭제</button>
                        </div>
                      )}
                    </Card>
                  );
                })}
                <button type="button" onClick={() => { if (!requireAuth("강의를 추가하려면 로그인이 필요해요")) return; setShowAddCourse(true); }} style={{
                  minHeight: 120, borderRadius: 18, border: "1px dashed var(--color-border)",
                  background: "var(--color-card)", color: PINK, fontSize: 15, fontWeight: 850, cursor: "pointer",
                }}>+ 강의 추가하기</button>
              </div>
            )}
          </div>

          {/* D-day + 학습 계획 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* D-day */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: PINK }}>D-day</h3>
                <button type="button" onClick={() => { if (!requireAuth("D-day를 추가하려면 로그인이 필요해요")) return; setShowAddDday(true); }} aria-label="D-day 추가" title="D-day 추가" style={{
                  background: "none", border: "none", fontSize: 20, color: PINK, cursor: "pointer", lineHeight: 1
                }}>+</button>
              </div>
              {sortedDdays.length === 0 ? (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "10px 0" }}>설정된 D-day가 없습니다</p>
              ) : (
                <>
                  {displayDdays.map((d, i) => {
                    const left = getDaysLeft(d.date);
                    const type = d.type || "assignment";
                    return (
                      <div key={d.id || `${d.subj}-${d.date}-${i}`} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 0", borderBottom: i < displayDdays.length - 1 ? "1px solid var(--color-border-soft)" : "none"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0, padding: "3px 7px", borderRadius: 999,
                            background: ddayTypeColors[type].soft,
                            color: ddayTypeColors[type].solid,
                            fontSize: 11, fontWeight: 800,
                          }}>{ddayTypeLabels[type]}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-strong)", wordBreak: "break-word" }}>{d.subj}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: left <= 7 ? PINK : CYAN }}>
                            {left > 0 ? `D-${left}` : left === 0 ? "D-Day!" : `D+${Math.abs(left)}`}
                          </span>
                          <button type="button"
                            className="tongkk-icon-btn danger"
                            onClick={() => deleteDday(d)}
                            aria-label={`${d.subj} D-day 삭제`}
                            title="삭제"
                            style={{
                              width: 24, height: 24, borderRadius: 8, border: "1px solid var(--color-border-soft)",
                              background: "var(--color-card)", color: "var(--color-muted)", cursor: "pointer", fontSize: 15,
                              lineHeight: "22px", padding: 0,
                            }}
                          >×</button>
                        </div>
                      </div>
                    );
                  })}
                  {sortedDdays.length > 3 && (
                    <button type="button" onClick={() => setShowAllDdays(!showAllDdays)} style={{
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
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>오늘의 학습계획</h3>
                <button
                  type="button"
                  className="tongkk-hover-dim"
                  onClick={() => navigate(pageRoutes["학습 캘린더"])}
                  aria-label="학습 캘린더 열기"
                  title="학습 캘린더"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-border-soft)",
                    background: "var(--color-card)", color: "var(--color-text-secondary)", cursor: "pointer", padding: 0,
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                  </svg>
                </button>
              </div>
              {studyPlanMessage ? (
                <p style={{ margin: "0 0 12px", color: "var(--color-text)", fontSize: 13, lineHeight: 1.6 }}>
                  {studyPlanMessage}
                  {planUndoSnapshot && (
                    <button
                      type="button"
                      onClick={undoStudyPlan}
                      style={{
                        marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                        border: "1px solid var(--color-border-soft)", background: "var(--color-card)",
                        color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 750,
                      }}
                    >
                      되돌리기
                    </button>
                  )}
                </p>
              ) : (
                <p style={{ margin: "0 0 12px", color: "var(--color-muted)", fontSize: 13, lineHeight: 1.6 }}>
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
                      flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${!canGenerateStudyPlan || studyPlanLoading ? "var(--color-border-soft)" : CYAN}`,
                      background: "var(--color-card)",
                      color: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-muted)" : CYAN,
                      cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                      fontSize: 13, fontWeight: 800,
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
                      width: 30, flexShrink: 0, borderRadius: 8,
                      border: "1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent)", background: "var(--color-card)",
                      color: CYAN, cursor: "pointer", fontSize: 13, fontWeight: 800, padding: 0,
                    }}
                  >
                    {showStudyPlanOptions ? "⌃" : "⌄"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!requireAuth("학습 계획을 추가하려면 로그인이 필요해요")) return; setShowAddPlan(true); }}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${CYAN}`, background: "var(--color-card)",
                    color: CYAN, cursor: "pointer", fontSize: 13, fontWeight: 800,
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
                        padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-soft)",
                        background: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-surface)" : "var(--color-card)",
                        color: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-muted)" : "var(--color-text-secondary)",
                        cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {showPlanSourcePicker && (
                <div style={{
                  marginBottom: 14, padding: 12, borderRadius: 12,
                  border: "1px solid color-mix(in srgb, var(--color-cyan) 18%, transparent)", background: "var(--color-card)",
                }}>
                  <p style={{ margin: "0 0 4px", fontSize: 13, lineHeight: 1.55, color: "var(--color-text)" }}>
                    {planSourceMessage}
                  </p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)" }}>
                    직접 작성한 계획은 그대로 유지돼요. 함께 반영한 남은 계획과 이전 AI 계획만 새로 짜드려요.
                  </p>
                  {([
                    { title: "D-day", sources: ddayPlanSources },
                    { title: "복습 추천", sources: reviewPlanSources },
                  ] as const).map(group => (
                    group.sources.length > 0 && (
                      <div key={group.title} style={{ marginBottom: 12 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "var(--color-muted)" }}>{group.title}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {group.sources.map(source => {
                            const selected = selectedPlanSourceKeys.includes(source.key);
                            const accent = source.kind === "review" ? CYAN : ddayTypeColors[source.kind].solid;
                            const selectedBackground = source.kind === "review" ? "var(--color-tint-cyan)" : ddayTypeColors[source.kind].soft;
                            return (
                              <button
                                key={source.key}
                                type="button"
                                onClick={() => togglePlanSource(source.key)}
                                style={{
                                  maxWidth: "100%", padding: "6px 9px", borderRadius: 999,
                                  border: `1px solid ${selected ? accent : "var(--color-border-soft)"}`,
                                  background: selected ? selectedBackground : "var(--color-card)",
                                  color: selected ? accent : "var(--color-text-secondary)",
                                  cursor: "pointer", fontSize: 12, fontWeight: selected ? 800 : 650,
                                  textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
                  {incompletePlans.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "var(--color-muted)" }}>남아있는 학습계획</p>
                      <button
                        type="button"
                        onClick={() => setIncludeCarryover(prev => !prev)}
                        style={{
                          padding: "6px 9px", borderRadius: 999,
                          border: `1px solid ${includeCarryover ? "var(--color-text-secondary)" : "var(--color-border-soft)"}`,
                          background: includeCarryover ? "var(--color-surface)" : "var(--color-card)",
                          color: includeCarryover ? "var(--color-text-secondary)" : "var(--color-muted)",
                          cursor: "pointer", fontSize: 12, fontWeight: includeCarryover ? 800 : 650,
                        }}
                      >
                        {includeCarryover ? "✓ " : ""}남은 계획 {incompletePlans.length}개 함께 반영
                      </button>
                    </div>
                  )}
                  {([
                    {
                      title: "공부 목표",
                      value: studyPlanGoal,
                      set: (v: string) => setStudyPlanGoal(v as StudyPlanGoal),
                      options: [
                        { label: "시험 대비", value: "exam" },
                        { label: "과제", value: "assignment" },
                        { label: "평소 복습", value: "review" },
                      ],
                    },
                    {
                      title: "지금 상태",
                      value: studyPlanFamiliarity,
                      set: (v: string) => setStudyPlanFamiliarity(v as StudyPlanFamiliarity),
                      options: [
                        { label: "처음 봐요", value: "new" },
                        { label: "수업은 들었어요", value: "attended" },
                        { label: "복습해 봤어요", value: "reviewed" },
                      ],
                    },
                    {
                      title: "하루 공부 시간",
                      value: String(studyPlanDailyMinutes),
                      set: (v: string) => setStudyPlanDailyMinutes(Number(v)),
                      options: [
                        { label: "30분", value: "30" },
                        { label: "1시간", value: "60" },
                        { label: "2시간+", value: "120" },
                      ],
                    },
                  ] as const).map(question => (
                    <div key={question.title} style={{ marginBottom: 12 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "var(--color-muted)" }}>{question.title}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                        {question.options.map(option => {
                          const selected = question.value === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => question.set(option.value)}
                              style={{
                                padding: "6px 9px", borderRadius: 999,
                                border: `1px solid ${selected ? CYAN : "var(--color-border-soft)"}`,
                                background: selected ? "var(--color-tint-cyan)" : "var(--color-card)",
                                color: selected ? CYAN : "var(--color-text-secondary)",
                                cursor: "pointer", fontSize: 12, fontWeight: selected ? 800 : 650,
                              }}
                            >
                              {selected ? "✓ " : ""}{option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {studyPlanFamiliarity === "new" && diagnosticCourse && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      marginBottom: 12, padding: "8px 10px", borderRadius: 9,
                      background: "var(--color-card)", border: "1px solid var(--color-border-soft)",
                    }}>
                      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                        처음이라면 「{diagnosticCourse}」 쉬운 5문제로 현재 수준을 먼저 확인해보세요.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate(pageRoutes["퀴즈 생성"], { state: { course: diagnosticCourse, diagnostic: true, fromDashboard: true } })}
                        style={{
                          flexShrink: 0, padding: "6px 9px", borderRadius: 8, border: `1px solid ${CYAN}`,
                          background: "var(--color-card)", color: CYAN, cursor: "pointer", fontSize: 12, fontWeight: 800,
                        }}
                      >
                        진단 퀴즈 풀기
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setShowPlanSourcePicker(false)}
                      style={{
                        padding: "7px 11px", borderRadius: 8, border: "1px solid var(--color-border-soft)",
                        background: "var(--color-card)", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 750,
                      }}
                    >취소</button>
                    <button
                      type="button"
                      onClick={requestStudyPlan}
                      disabled={!canSubmitPlan || studyPlanLoading}
                      style={{
                        padding: "7px 11px", borderRadius: 8, border: "none",
                        background: !canSubmitPlan || studyPlanLoading ? "var(--color-border-soft)" : CYAN,
                        color: "var(--color-on-brand)",
                        cursor: !canSubmitPlan || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12, fontWeight: 800,
                      }}
                    >
                      {studyPlanLoading ? "생성 중..." : "이대로 짜기"}
                    </button>
                  </div>
                </div>
              )}
              {studyPlanError && (
                <p style={{ margin: "0 0 12px", padding: 10, borderRadius: 9, background: "var(--color-tint-pink)", color: "var(--color-danger)", fontSize: 12, lineHeight: 1.5 }}>
                  {studyPlanError}
                </p>
              )}
              {!canGenerateStudyPlan && (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "6px 0 12px", margin: 0 }}>
                  먼저 D-day에 과제나 일정을 추가해보세요
                </p>
              )}
              {todayPlanEntries.length === 0 ? (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "6px 0", margin: 0 }}>아직 생성된 계획이 없습니다</p>
              ) : (
                <>
                  {todayPlanEntries.map(({ plan: p, index: i }, idx) => {
                    const planKey = p.id || `index-${i}`;
                    const isEditing = editingPlanKey === planKey;
                    const showTopBorder = idx > 0;
                    return (
                      <div key={p.id || `${p.text}-${i}`} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                        borderTop: showTopBorder ? "1px solid var(--color-border-soft)" : "none"
                      }}>
                        <button type="button" onClick={() => {
                          setPlans(prev => prev.map((item, index) => index === i ? { ...item, done: !item.done } : item));
                        }} style={{
                          width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "var(--color-border-soft)"}`,
                          background: p.done ? CYAN : "var(--color-card)", cursor: "pointer", display: "flex",
                          alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
                        }}>
                          {p.done && <span style={{ color: "var(--color-on-brand)", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
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
                              flex: 1, minWidth: 0, padding: "7px 9px", borderRadius: 8,
                              border: `1px solid ${CYAN}`, outline: "none", fontSize: 14,
                              color: "var(--color-text-strong)", boxSizing: "border-box",
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="tongkk-plan-text"
                            onClick={() => startEditPlan(p, i)}
                            title="클릭해서 수정"
                            style={{
                              flex: 1, minWidth: 0, border: "none", background: "none",
                              padding: 0, cursor: "text", textAlign: "left", fontSize: 14,
                              color: p.done ? "var(--color-muted)" : "var(--color-text)",
                              textDecoration: p.done ? "line-through" : "none",
                              lineHeight: 1.45, wordBreak: "break-word",
                            }}
                          >
                            {p.origin === "ai" && (
                              <span style={{
                                display: "inline-block", marginRight: 6, padding: "1px 6px", borderRadius: 999,
                                background: "var(--color-tint-cyan)", color: CYAN, fontSize: 10, fontWeight: 850,
                                verticalAlign: "1px", textDecoration: "none",
                              }}>AI</span>
                            )}
                            {p.text}
                            <span className="tongkk-plan-edit-hint" aria-hidden>✎</span>
                          </button>
                        )}
                        {p.action && !isEditing && (p.action === "review_wrong" || resolvePlanCourse(p.course)) && (
                          <button
                            type="button"
                            className="tongkk-icon-btn accent"
                            onClick={() => openPlanAction(p)}
                            aria-label={`${planActionLabels[p.action]}로 이동`}
                            title={planActionLabels[p.action]}
                            style={{
                              width: 24, height: 24, borderRadius: 8, border: `1px solid ${CYAN}`,
                              background: "var(--color-card)", color: CYAN, cursor: "pointer", fontSize: 13,
                              lineHeight: "22px", padding: 0, flexShrink: 0, fontWeight: 800,
                            }}
                          >↗</button>
                        )}
                        <button type="button"
                          className="tongkk-icon-btn danger"
                          onClick={() => deletePlan(p, i)}
                          aria-label={`${p.text} 학습 계획 삭제`}
                          title="삭제"
                          style={{
                            width: 24, height: 24, borderRadius: 8, border: "1px solid var(--color-border-soft)",
                            background: "var(--color-card)", color: "var(--color-muted)", cursor: "pointer", fontSize: 15,
                            lineHeight: "22px", padding: 0, flexShrink: 0,
                          }}
                        >×</button>
                      </div>
                    );
                  })}
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
