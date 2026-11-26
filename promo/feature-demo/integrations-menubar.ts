import { useSyncExternalStore } from 'react';
export type MenubarTheme = 'system' | 'light' | 'dark';
export type DdayScope = 'exam' | 'exam-assignment';
export type ReminderSettings = { time: string; dayBefore: boolean };
export const REMINDER_KEY = 'menubarReminders';
export const defaultReminders = { time: '09:00', dayBefore: true };
let display: { theme: MenubarTheme; ddayScope: DdayScope } = { theme: 'light', ddayScope: 'exam' };
let reminder = { ...defaultReminders };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useMenubarDisplay() { return useSyncExternalStore(subscribe, () => display, () => display); }
export function saveMenubarDisplay(settings: typeof display) {
  display = { ...settings };
  const theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  listeners.forEach(listener => listener());
}
export function normalizeReminders(value: unknown): ReminderSettings {
  const saved = value as Partial<ReminderSettings> | null;
  return { time: typeof saved?.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(saved.time) ? saved.time : defaultReminders.time, dayBefore: typeof saved?.dayBefore === 'boolean' ? saved.dayBefore : true };
}
export function readReminderCache() { return { ...reminder }; }
export function writeReminderCache(_userId: string | null, value: ReminderSettings) { reminder = normalizeReminders(value); }
export function formatMenubarTime(time: string) { const [hour, minute] = time.split(':').map(Number); return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(minute).padStart(2, '0')}`; }
