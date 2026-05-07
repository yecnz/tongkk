import { createContext, useContext, useState, type ReactNode } from "react";

const COURSES_KEY = "tongkk:courses";

function loadCourses(): string[] {
  try {
    const raw = localStorage.getItem(COURSES_KEY);
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
};

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<string[]>(loadCourses);

  const persistCourses = (next: string[]) => {
    localStorage.setItem(COURSES_KEY, JSON.stringify(next));
  };

  const moveStorageKey = (oldKey: string, newKey: string) => {
    const value = localStorage.getItem(oldKey);
    if (value === null) return;
    localStorage.setItem(newKey, value);
    localStorage.removeItem(oldKey);
  };

  const removeCourseStorage = (course: string) => {
    [
      `tongkk:materials:${course}`,
      `tongkk:markdown:${course}`,
      `tongkk:material:${course}`,
      `tongkk:summary:${course}`,
    ].forEach(key => localStorage.removeItem(key));
  };

  const addCourse = (name: string) => {
    setCourses(prev => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      persistCourses(next);
      return next;
    });
  };

  const renameCourse = (oldName: string, newName: string) => {
    setCourses(prev => {
      if (oldName === newName || prev.includes(newName)) return prev;
      const next = prev.map(course => course === oldName ? newName : course);
      persistCourses(next);
      moveStorageKey(`tongkk:materials:${oldName}`, `tongkk:materials:${newName}`);
      moveStorageKey(`tongkk:markdown:${oldName}`, `tongkk:markdown:${newName}`);
      moveStorageKey(`tongkk:material:${oldName}`, `tongkk:material:${newName}`);
      moveStorageKey(`tongkk:summary:${oldName}`, `tongkk:summary:${newName}`);
      return next;
    });
  };

  const deleteCourse = (name: string) => {
    setCourses(prev => {
      const next = prev.filter(course => course !== name);
      persistCourses(next);
      removeCourseStorage(name);
      return next;
    });
  };

  const value = { courses, addCourse, renameCourse, deleteCourse };

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
