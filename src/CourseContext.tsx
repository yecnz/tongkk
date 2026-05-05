import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type CourseContextValue = {
  courses: string[];
  addCourse: (name: string) => void;
};

const CourseContext = createContext<CourseContextValue | null>(null);

export function CourseProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<string[]>([]);
  const addCourse = (name: string) => setCourses(prev => [...prev, name]);
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
