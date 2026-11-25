import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadDashboardState } from "./dashboardState";
import { defaultReminders, normalizeReminders, readReminderCache, REMINDER_KEY } from "./menubarSettings";
import { paceDateKey } from "./pace";
import { loadUserProfile } from "./profile";
import type { Dday, Plan } from "./studyPlanner";

type ReminderKind = "plans" | "deadlines";
const CHECK_INTERVAL = 60_000;
const sentKey = (userId: string, kind: ReminderKind) => `tongkk:study-reminder:${userId}:${kind}`;

function useStudyReminders(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    const owner = userId;
    let active = true;
    let checking = false;
    const sent = new Map<ReminderKind, string>();
    function wasSent(kind: ReminderKind, day: string) {
      if (sent.get(kind) === day) return true;
      try { return localStorage.getItem(sentKey(owner, kind)) === day; } catch { return false; }
    }
    async function notify(kind: ReminderKind, day: string) {
      if (!active || wasSent(kind, day)) return;
      await invoke("notify_study", { kind });
      sent.set(kind, day);
      try { localStorage.setItem(sentKey(owner, kind), day); } catch { /* Deduplicate in this session. */ }
    }
    async function check() {
      if (checking) return;
      const now = new Date();
      const today = paceDateKey(now);
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (wasSent("plans", today) && wasSent("deadlines", today)) return;
      checking = true;
      try {
        const [profile, saved] = await Promise.all([
          loadUserProfile(),
          loadDashboardState<unknown>(REMINDER_KEY, readReminderCache(owner)),
        ]);
        if (!active || !profile.notificationsEnabled) return;
        const { time, dayBefore } = normalizeReminders(saved);
        const notifications: Promise<void>[] = [];
        if (currentTime >= time && !wasSent("plans", today)) {
          notifications.push(loadDashboardState<Plan[]>("plans", []).then(plans => {
            if (plans.some(plan => !plan.done && (!plan.date || plan.date === today))) return notify("plans", today);
          }));
        }
        if (dayBefore && currentTime >= defaultReminders.time && !wasSent("deadlines", today)) {
          const target = new Date(now);
          target.setDate(now.getDate() + 1);
          const tomorrow = paceDateKey(target);
          notifications.push(loadDashboardState<Dday[]>("ddays", []).then(ddays => {
            if (ddays.some(item => item.date === tomorrow && item.type !== "event")) return notify("deadlines", today);
          }));
        }
        const results = await Promise.allSettled(notifications);
        for (const result of results) if (result.status === "rejected") console.warn("학습 알림을 보내지 못했어요.", result.reason);
      } catch (error) {
        if (active) console.warn("학습 알림을 확인하지 못했어요.", error);
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(check, CHECK_INTERVAL);
    window.addEventListener("tongkk:mini-open", check);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("tongkk:mini-open", check);
    };
  }, [userId]);
}

export default useStudyReminders;
