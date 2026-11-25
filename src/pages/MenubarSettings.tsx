import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import LoginModal from "../components/LoginModal";
import ReminderTimePicker from "../components/ReminderTimePicker";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { hasNewWebBuild } from "../services/appVersion";
import { loadUserProfile, updateNotificationsEnabled, type UserProfile } from "../services/profile";
import {
  normalizeReminders, readReminderCache, REMINDER_KEY, saveMenubarDisplay, useMenubarDisplay, writeReminderCache,
  type DdayScope, type MenubarTheme, type ReminderSettings,
} from "../services/menubarSettings";
import trafficLight from "../assets/menubar-settings/traffic-lights-light.svg";
import trafficDark from "../assets/menubar-settings/traffic-lights-dark.svg";
import checkLight from "../assets/menubar-settings/check-light.svg";
import checkDark from "../assets/menubar-settings/check-dark.svg";
import externalLight from "../assets/menubar-settings/external-link-light.svg";
import externalDark from "../assets/menubar-settings/external-link-dark.svg";
import desktopConfig from "../../src-tauri/tauri.conf.json";
import "./MenubarSettings.css";

const tabs = [["general", "일반"], ["menubar", "메뉴바"], ["account", "계정"]] as const;
const themes = [["system", "시스템"], ["light", "라이트"], ["dark", "다크"]] as const;
const ddayOptions = [["exam", "시험만"], ["exam-assignment", "시험 + 과제"]] as const;
type Tab = typeof tabs[number][0];

function Segmented<T extends string>({ options, value, onChange, label, tabId }: {
  options: readonly (readonly [T, string])[];
  value: T; onChange: (value: T) => void; label: string; tabId?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex(([option]) => option === value);
    const last = options.length - 1;
    const next = event.key === "ArrowRight" ? (index + 1) % options.length
      : event.key === "ArrowLeft" ? (index + last) % options.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next][0]);
    event.currentTarget.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div className={`menubar-segmented ${tabId ? "menubar-segmented-tabs" : ""}`}
      role={tabId ? "tablist" : "radiogroup"} aria-label={label} onKeyDown={onKeyDown}>
      {options.map(([option, text]) => <button key={option} type="button" value={option} role={tabId ? "tab" : "radio"}
        id={tabId ? `${tabId}-${option}` : undefined}
        aria-controls={tabId ? `${tabId}-panel` : undefined}
        aria-selected={tabId ? value === option : undefined}
        aria-checked={!tabId ? value === option : undefined}
        tabIndex={value === option ? 0 : -1} onClick={() => onChange(option)}>{text}</button>)}
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="menubar-settings-group" aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    <div className="menubar-settings-card">{children}</div>
  </section>;
}

function CheckRow({ label, checked, disabled, dark, onChange }: {
  label: string; checked: boolean; disabled?: boolean; dark: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className="menubar-check-row">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="menubar-check-icon" aria-hidden="true">{checked && <img src={dark ? checkDark : checkLight} alt="" />}</span>
    {label}
  </label>;
}

export default function MenubarSettings() {
  const { user, loading, signOut } = useAuth();
  return <SettingsWindow key={user?.id ?? "guest"} userId={user?.id ?? null} email={user?.email}
    loading={loading} signOut={() => signOut({ scope: "local" })} />;
}

function SettingsWindow({ userId, email, loading, signOut }: {
  userId: string | null; email?: string; loading: boolean; signOut: () => Promise<void>;
}) {
  const tabId = useId();
  const navigate = useNavigate();
  const shell = useRef<HTMLElement>(null);
  const requestPending = useRef(false);
  const native = isTauri();
  const display = useMenubarDisplay();
  const [tab, setTab] = useState<Tab>("general");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reminders, setReminders] = useState(() => readReminderCache(userId));
  const [remindersReady, setRemindersReady] = useState(!userId);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState(desktopConfig.version);
  const [pending, setPending] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [error, setError] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [refreshAvailable, setRefreshAvailable] = useState(false);
  const dark = display.theme === "dark" || (display.theme === "system" && systemDark);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    system.addEventListener("change", onChange);
    return () => system.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!native) return;
    let active = true;
    void invoke<{ autostart: boolean; version: string }>("settings_info").then(info => {
      if (active) { setAutostart(info.autostart); setVersion(info.version); }
    }).catch(() => { if (active) setError("Mac 설정을 불러오지 못했어요."); });
    return () => { active = false; };
  }, [native]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void loadUserProfile().then(value => { if (active) setProfile(value); })
      .catch(() => { if (active) setError("계정 설정을 불러오지 못했어요."); });
    void loadDashboardState<unknown>(REMINDER_KEY, readReminderCache(userId)).then(value => {
      if (!active) return;
      const next = normalizeReminders(value);
      setReminders(next);
      setRemindersReady(true);
    }).catch(() => { if (active) setError("알림 설정을 불러오지 못했어요."); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!native || !shell.current) return;
    let scheduled = 0;
    let lastHeight = 0;
    const observer = new ResizeObserver(([entry]) => {
      window.cancelAnimationFrame(scheduled);
      scheduled = window.requestAnimationFrame(() => {
        const measured = Math.ceil(entry.target.getBoundingClientRect().height);
        const height = showLogin ? Math.max(520, measured) : measured;
        if (height === lastHeight) return;
        lastHeight = height;
        void invoke("resize_settings", { height }).catch(console.warn);
      });
    });
    observer.observe(shell.current);
    return () => {
      window.cancelAnimationFrame(scheduled);
      observer.disconnect();
    };
  }, [native, showLogin]);

  async function runAction(action: () => Promise<void>, message: string) {
    if (requestPending.current) return;
    requestPending.current = true;
    setPending(true);
    setError("");
    try { await action(); } catch { setError(message); }
    finally { requestPending.current = false; setPending(false); }
  }

  function saveReminder(next: ReminderSettings) {
    void runAction(async () => {
      if (userId) await saveDashboardState(REMINDER_KEY, next);
      writeReminderCache(userId, next);
      setReminders(next);
    }, "알림 설정을 저장하지 못했어요.");
  }

  function changeNotifications(enabled: boolean) {
    if (!profile) return;
    void runAction(async () => {
      await updateNotificationsEnabled(enabled);
      setProfile({ ...profile, notificationsEnabled: enabled });
      writeReminderCache(userId, reminders);
    }, "알림 설정을 저장하지 못했어요.");
  }

  function checkUpdates() {
    void runAction(async () => {
      const available = await hasNewWebBuild();
      setRefreshAvailable(available);
      setUpdateMessage(available ? "새 버전이 있어요." : "최신 웹 버전을 사용 중이에요.");
    }, "버전을 확인하지 못했어요.");
  }

  function closeWindow() {
    if (native) void invoke("close_settings").catch(console.warn);
    else navigate("/mini");
  }

  const nickname = profile?.nickname.trim() || email?.split("@")[0] || "학생";
  const initials = Array.from(nickname).slice(0, 2).join("");
  const remindersDisabled = pending || !remindersReady || loading || profile?.notificationsEnabled === false;
  return <div className="menubar-settings-stage">
    <main ref={shell} className="menubar-settings-window" aria-label="Tongkk 설정">
      <header className="menubar-settings-titlebar" onDoubleClick={event => event.preventDefault()}
        onPointerDown={event => {
          if (native && event.button === 0 && !(event.target as HTMLElement).closest("button")) {
            void invoke("drag_settings").catch(console.warn);
          }
        }}>
        <div className="menubar-traffic-lights">
          <img src={dark ? trafficDark : trafficLight} alt="" />
          <button type="button" aria-label="설정 닫기" onClick={closeWindow} />
          <button type="button" aria-label="설정 최소화" disabled={!native} onClick={() => void invoke("minimize_settings").catch(console.warn)} />
          <span />
        </div>
        <h1>Tongkk 설정</h1>
      </header>
      <div className="menubar-settings-content">
        <Segmented options={tabs} value={tab} onChange={setTab} label="설정 탭" tabId={tabId} />
        <div className="menubar-tab-panel" role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`}>
          {tab === "general" && <>
            <SettingsGroup title="모양">
              <div className="menubar-settings-row menubar-theme-row">
                <span>테마</span>
                <Segmented<MenubarTheme> options={themes} value={display.theme} label="테마"
                  onChange={theme => saveMenubarDisplay({ ...display, theme })} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="기본">
              <CheckRow label="Mac 로그인 시 자동 실행" checked={autostart === true} dark={dark}
                disabled={autostart === null || pending}
                onChange={enabled => void runAction(async () => {
                  setAutostart(await invoke<boolean>("set_settings_autostart", { enabled }));
                }, "자동 실행 설정을 바꾸지 못했어요.")} />
              <hr />
              <CheckRow label="알림 받기" checked={profile?.notificationsEnabled ?? true} dark={dark}
                disabled={!profile || pending} onChange={changeNotifications} />
              <div className="menubar-settings-row menubar-time-row">
                <span>오늘 할 일 알림 시간</span>
                <ReminderTimePicker value={reminders.time} dark={dark} disabled={remindersDisabled}
                  onChange={time => saveReminder({ ...reminders, time })} />
              </div>
              <CheckRow label="시험·과제 하루 전 알림" checked={reminders.dayBefore} dark={dark}
                disabled={remindersDisabled} onChange={dayBefore => saveReminder({ ...reminders, dayBefore })} />
              <p className="menubar-settings-note">알림 설정은 Tongkk 웹과 함께 저장돼요.</p>
            </SettingsGroup>
          </>}
          {tab === "menubar" && <SettingsGroup title="메뉴바">
            <div className="menubar-settings-row menubar-theme-row">
              <span>D-day에 포함할 일정</span>
              <Segmented<DdayScope> options={ddayOptions} value={display.ddayScope} label="D-day에 포함할 일정"
                onChange={ddayScope => saveMenubarDisplay({ ...display, ddayScope })} />
            </div>
            <hr />
            <div className="menubar-settings-row menubar-action-row"><span>메뉴바 창 열기 단축키</span>
              <kbd className="menubar-settings-button">⌥ ⌘ T</kbd></div>
            <p className="menubar-settings-note">할 일을 체크하면 Tongkk 웹에도 바로 반영돼요.</p>
          </SettingsGroup>}
          {tab === "account" && <>
            <SettingsGroup title="계정">
              <div className="menubar-settings-row menubar-profile">
                {userId ? <>
                  <span className="menubar-settings-avatar" aria-hidden="true">
                    {profile?.avatarUrl && !avatarFailed ? <img src={profile.avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : initials}
                  </span>
                  <div className="menubar-profile-info"><strong>{nickname}</strong>{email && <span title={email}>{email}</span>}</div>
                  <button className="menubar-settings-button" type="button" disabled={pending}
                    onClick={() => void runAction(signOut, "로그아웃하지 못했어요.")}>로그아웃</button>
                </> : <>
                  <span>{loading ? "계정을 불러오는 중…" : "Tongkk에 로그인하세요."}</span>
                  {!loading && <button className="menubar-settings-button" type="button" onClick={() => setShowLogin(true)}>로그인</button>}
                </>}
              </div>
            </SettingsGroup>
            <SettingsGroup title="지원">
              <a className="menubar-settings-row menubar-support-row" href="/" target="_blank" rel="noreferrer">Tongkk 웹 열기
                <img src={dark ? externalDark : externalLight} alt="" /></a>
              <hr />
              <a className="menubar-settings-row menubar-support-row" href="mailto:tongkk.team@gmail.com?subject=Tongkk%20문의" target="_blank" rel="noreferrer">문의하기
                <img src={dark ? externalDark : externalLight} alt="" /></a>
            </SettingsGroup>
            <SettingsGroup title="정보">
              <div className="menubar-settings-row menubar-action-row"><span>버전</span>
                <div className="menubar-settings-version"><span>{version}</span>
                  <button type="button" className="menubar-settings-button" disabled={pending}
                    onClick={refreshAvailable ? () => window.location.reload() : checkUpdates}>{refreshAvailable ? "새로고침" : "업데이트 확인"}</button>
                </div>
              </div>
              {updateMessage && <p className="menubar-settings-note" role="status">{updateMessage}</p>}
            </SettingsGroup>
          </>}
          {error && <p className="menubar-settings-error" role="alert">{error}</p>}
        </div>
      </div>
    </main>
    {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
  </div>;
}
