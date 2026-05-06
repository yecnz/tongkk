import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

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
};

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<string[]>(loadCourses);

  const addCourse = (name: string) => {
    setCourses(prev => {
      const next = [...prev, name];
      localStorage.setItem(COURSES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const value = useMemo(() => ({ courses, addCourse }), [courses]);

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
