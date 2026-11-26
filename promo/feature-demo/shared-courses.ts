export type CourseRecord = { id: string; name: string; createdAt: number; updatedAt: number };
let courses: CourseRecord[] = [{ id: 'course-demo', name: '알고리즘', createdAt: Date.now(), updatedAt: Date.now() }];
export const invalidateCoursesCache = () => {};
export const fetchCourses = async () => structuredClone(courses);
export async function createCourse(name: string) { const course = { id: crypto.randomUUID(), name, createdAt: Date.now(), updatedAt: Date.now() }; courses.push(course); return { ...course }; }
export async function updateCourse(id: string, name: string) { courses = courses.map(c => c.id === id ? { ...c, name } : c); return courses.find(c => c.id === id); }
export async function removeCourse(id: string) { courses = courses.filter(c => c.id !== id); }
