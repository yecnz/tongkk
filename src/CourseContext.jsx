import { createContext, useContext, useState } from "react";

const CourseContext = createContext(null);

export function CourseProvider({ children }) {
  const [courses, setCourses] = useState([]);
  const addCourse = (name) => setCourses(prev => [...prev, name]);
  return (
    <CourseContext.Provider value={{ courses, addCourse }}>
      {children}
    </CourseContext.Provider>
  );
}

export const useCourses = () => useContext(CourseContext);
