import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createCourse,
  fetchCourses,
  removeCourse,
  updateCourse,
  type CourseRecord,
} from "./services/courses";
import { useAuth } from "./AuthContext";
import { cacheCourseId, getCachedCourseId } from "./services/materials";

const legacyCoursesKey = "tongkk:courses";
const coursesKey = (userId: string) => `tongkk:${userId}:courses`;
const courseIdKey = (course: string) => `tongkk:course-id:${course}`;

function loadCourses(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

type CourseContextValue = {
  courses: string[];
  addCourse: (name: string) => void;
  renameCourse: (oldName: string, newName: string) => void;
  deleteCourse: (name: string) => void;
  isSyncingCourses: boolean;
  courseSyncError: string;
};

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentCoursesKey = user ? coursesKey(user.id) : legacyCoursesKey;
  const [courses, setCourses] = useState<string[]>([]);
  const [isSyncingCourses, setIsSyncingCourses] = useState(false);
  const [courseSyncError, setCourseSyncError] = useState("");

  const persistCourses = (next: string[]) => {
    localStorage.setItem(currentCoursesKey, JSON.stringify(next));
  };

  const applyServerCourses = useCallback((serverCourses: CourseRecord[]) => {
    serverCourses.forEach(course => cacheCourseId(course.name, course.id));
    const names = serverCourses.map(course => course.name);
    setCourses(names);
    localStorage.setItem(currentCoursesKey, JSON.stringify(names));
  }, [currentCoursesKey]);

  const moveStorageKey = (oldKey: string, newKey: string) => {
    const value = localStorage.getItem(oldKey);
    if (value === null) return;
    localStorage.setItem(newKey, value);
    localStorage.removeItem(oldKey);
  };

  useEffect(() => {
    let ignore = false;
    if (!user) {
      setCourses([]);
      return () => {
        ignore = true;
      };
    }

    setCourses(loadCourses(currentCoursesKey));

    const loadServerCourses = async () => {
      setIsSyncingCourses(true);
      setCourseSyncError("");
      try {
        const serverCourses = await fetchCourses();
        if (!ignore) applyServerCourses(serverCourses);
      } catch (err) {
        if (!ignore) {
          setCourseSyncError(err instanceof Error ? err.message : "강의 목록 동기화 실패");
        }
      } finally {
        if (!ignore) setIsSyncingCourses(false);
      }
    };

    loadServerCourses();
    return () => {
      ignore = true;
    };
  }, [applyServerCourses, currentCoursesKey, user]);

  const removeCourseStorage = (course: string) => {
    [
      `tongkk:materials:${course}`,
      `tongkk:markdown:${course}`,
      `tongkk:material:${course}`,
      `tongkk:summary:${course}`,
      courseIdKey(course),
    ].forEach(key => localStorage.removeItem(key));
  };

  const addCourse = (name: string) => {
    setCourses(prev => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      persistCourses(next);
      return next;
    });

    createCourse(name)
      .then(course => cacheCourseId(course.name, course.id))
      .catch(async error => {
        setCourseSyncError(error instanceof Error ? error.message : "강의 추가 동기화 실패");
        try {
          applyServerCourses(await fetchCourses());
        } catch {
          // Keep optimistic local state when the server is unavailable.
        }
      });
  };

  const renameCourse = (oldName: string, newName: string) => {
    const courseId = getCachedCourseId(oldName);
    setCourses(prev => {
      if (oldName === newName || prev.includes(newName)) return prev;
      const next = prev.map(course => course === oldName ? newName : course);
      persistCourses(next);
      moveStorageKey(`tongkk:materials:${oldName}`, `tongkk:materials:${newName}`);
      moveStorageKey(`tongkk:markdown:${oldName}`, `tongkk:markdown:${newName}`);
      moveStorageKey(`tongkk:material:${oldName}`, `tongkk:material:${newName}`);
      moveStorageKey(`tongkk:summary:${oldName}`, `tongkk:summary:${newName}`);
      moveStorageKey(courseIdKey(oldName), courseIdKey(newName));
      return next;
    });

    if (!courseId) return;
    updateCourse(courseId, newName)
      .then(course => cacheCourseId(course.name, course.id))
      .catch(async error => {
        setCourseSyncError(error instanceof Error ? error.message : "강의 이름 변경 동기화 실패");
        try {
          applyServerCourses(await fetchCourses());
        } catch {
          // Keep optimistic local state when the server is unavailable.
        }
      });
  };

  const deleteCourse = (name: string) => {
    const courseId = getCachedCourseId(name);
    setCourses(prev => {
      const next = prev.filter(course => course !== name);
      persistCourses(next);
      removeCourseStorage(name);
      return next;
    });

    if (!courseId) return;
    removeCourse(courseId).catch(async error => {
      setCourseSyncError(error instanceof Error ? error.message : "강의 삭제 동기화 실패");
      try {
        applyServerCourses(await fetchCourses());
      } catch {
        // Keep optimistic local state when the server is unavailable.
      }
    });
  };

  const value = { courses, addCourse, renameCourse, deleteCourse, isSyncingCourses, courseSyncError };

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
