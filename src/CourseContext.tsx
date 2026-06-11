import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createCourse,
  fetchCourses,
  removeCourse,
  updateCourse,
  type CourseRecord,
} from "./services/courses";
import { useAuth } from "./AuthContext";

type CourseContextValue = {
  courses: string[];
  addCourse: (name: string) => void;
  renameCourse: (oldName: string, newName: string) => void;
  deleteCourse: (name: string) => void;
  isSyncingCourses: boolean;
  // 첫 서버 동기화가 끝났는지(성공/실패 무관). isSyncingCourses는 초기값이 false라
  // 첫 페인트에 빈 상태가 깜빡이는 것을 막을 수 없어 별도 플래그를 둔다.
  hasLoadedCourses: boolean;
  courseSyncError: string;
};

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [courses, setCourses] = useState<string[]>([]);
  const [courseRecords, setCourseRecords] = useState<CourseRecord[]>([]);
  const [isSyncingCourses, setIsSyncingCourses] = useState(false);
  const [hasLoadedCourses, setHasLoadedCourses] = useState(false);
  const [courseSyncError, setCourseSyncError] = useState("");

  const applyServerCourses = useCallback((serverCourses: CourseRecord[]) => {
    setCourseRecords(serverCourses);
    const names = serverCourses.map(course => course.name);
    setCourses(names);
  }, []);

  const reloadCourses = useCallback(async () => {
    const serverCourses = await fetchCourses();
    applyServerCourses(serverCourses);
    return serverCourses;
  }, [applyServerCourses]);

  useEffect(() => {
    let ignore = false;
    if (!user) {
      setCourses([]);
      setHasLoadedCourses(false);
      return () => {
        ignore = true;
      };
    }

    const loadServerCourses = async () => {
      setIsSyncingCourses(true);
      setCourseSyncError("");
      try {
        const serverCourses = await reloadCourses();
        if (!ignore) applyServerCourses(serverCourses);
      } catch (err) {
        if (!ignore) {
          setCourseSyncError(err instanceof Error ? err.message : "강의 목록 동기화 실패");
        }
      } finally {
        if (!ignore) {
          setIsSyncingCourses(false);
          // 실패해도 true로 — 스켈레톤이 무한히 남지 않고 빈 상태+오류 안내로 넘어간다.
          setHasLoadedCourses(true);
        }
      }
    };

    loadServerCourses();
    return () => {
      ignore = true;
    };
  }, [applyServerCourses, reloadCourses, user]);

  const addCourse = (name: string) => {
    createCourse(name)
      .then(() => reloadCourses())
      .catch(async error => {
        setCourseSyncError(error instanceof Error ? error.message : "강의 추가 동기화 실패");
        try {
          await reloadCourses();
        } catch {
          // Keep the sync error visible.
        }
      });
  };

  const renameCourse = (oldName: string, newName: string) => {
    const courseId = courseRecords.find(course => course.name === oldName)?.id;
    if (!courseId) return;
    updateCourse(courseId, newName)
      .then(() => reloadCourses())
      .catch(async error => {
        setCourseSyncError(error instanceof Error ? error.message : "강의 이름 변경 동기화 실패");
        try {
          await reloadCourses();
        } catch {
          // Keep the sync error visible.
        }
      });
  };

  const deleteCourse = (name: string) => {
    const courseId = courseRecords.find(course => course.name === name)?.id;
    if (!courseId) return;
    removeCourse(courseId)
      .then(() => reloadCourses())
      .catch(async error => {
        setCourseSyncError(error instanceof Error ? error.message : "강의 삭제 동기화 실패");
        try {
          await reloadCourses();
        } catch {
          // Keep the sync error visible.
        }
      });
  };

  const value = { courses, addCourse, renameCourse, deleteCourse, isSyncingCourses, hasLoadedCourses, courseSyncError };

  return (
    <CourseContext.Provider value={value}>
      {children}
    </CourseContext.Provider>
  );
}

export const useCourses = () => {
  const context = useContext(CourseContext);
  if (!context) {
    throw new Error("useCourses must be used inside CourseProvider");
  }
  return context;
};
