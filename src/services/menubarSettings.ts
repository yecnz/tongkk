import { useSyncExternalStore } from "react";

const SETTINGS_KEY = "tongkk:menubar-settings";
const SETTINGS_EVENT = "tongkk:menubar-settings-changed";
export const REMINDER_KEY = "menubarReminders";

export type MenubarTheme = "system" | "light" | "dark";
export type DdayScope = "exam" | "exam-assignment";
export type ReminderSettings = { time: string; dayBefore: boolean };
type DisplaySettings = { theme: MenubarTheme; ddayScope: DdayScope };

export const defaultReminders: ReminderSettings = { time: "09:00", dayBefore: true };

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

function parse(value: string | null): unknown {
  try { return JSON.parse(value ?? "null"); } catch { return null; }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SETTINGS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SETTINGS_EVENT, callback);
  };
}

export function useMenubarDisplay(): DisplaySettings {
  const raw = useSyncExternalStore(subscribe, () => readStorage(SETTINGS_KEY), () => null);
  const value = parse(raw) as Partial<DisplaySettings> | null;
  return {
    theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "system",
    ddayScope: value?.ddayScope === "exam-assignment" ? value.ddayScope : "exam",
  };
}

export function saveMenubarDisplay(settings: DisplaySettings) {
  writeStorage(SETTINGS_KEY, settings);
}

export function normalizeReminders(value: unknown): ReminderSettings {
  const saved = value as Partial<ReminderSettings> | null;
  return {
    time: typeof saved?.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(saved.time)
      ? saved.time : defaultReminders.time,
    dayBefore: typeof saved?.dayBefore === "boolean" ? saved.dayBefore : defaultReminders.dayBefore,
  };
}

const reminderCacheKey = (userId: string | null) => `tongkk:menubar-reminders:${userId ?? "guest"}`;

export function readReminderCache(userId: string | null) {
  return normalizeReminders(parse(readStorage(reminderCacheKey(userId))));
}

export function writeReminderCache(userId: string | null, value: ReminderSettings) {
  writeStorage(reminderCacheKey(userId), value);
}

export function formatMenubarTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
}
