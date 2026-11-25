import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Outlet, useLocation } from "react-router-dom";
import { useMenubarDisplay } from "../services/menubarSettings";
import { useAuth } from "../AuthContext";
import useStudyReminders from "../services/studyReminders";

export default function MenubarLayout() {
  const { theme } = useMenubarDisplay();
  const { pathname } = useLocation();
  const native = isTauri();
  const settings = pathname === "/mini/settings";
  const { user, loading } = useAuth();
  useStudyReminders(native && !settings && !loading ? user?.id ?? null : null);

  useEffect(() => {
    if (!native && !settings) return;
    const root = document.documentElement;
    const previous = root.dataset.theme;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => { root.dataset.theme = theme === "system" ? (system.matches ? "dark" : "light") : theme; };
    update();
    system.addEventListener("change", update);
    return () => {
      system.removeEventListener("change", update);
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, [native, settings, theme]);

  return <Outlet />;
}
