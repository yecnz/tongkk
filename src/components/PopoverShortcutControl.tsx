import { useId, useState, type KeyboardEvent } from "react";

export type PopoverShortcut = { accelerator: string; registered: boolean };

const defaultAccelerator = "alt+super+KeyT";
const modifierKeys = [
  ["ctrlKey", "control", "⌃"],
  ["altKey", "alt", "⌥"],
  ["shiftKey", "shift", "⇧"],
  ["metaKey", "super", "⌘"],
] as const;
const specialKeys = new Map([
  ["Space", "Space"], ["Tab", "⇥"], ["Enter", "↩"], ["Escape", "Esc"],
  ["Backspace", "⌫"], ["Delete", "⌦"], ["Home", "↖"], ["End", "↘"],
  ["PageUp", "⇞"], ["PageDown", "⇟"], ["ArrowLeft", "←"], ["ArrowRight", "→"],
  ["ArrowUp", "↑"], ["ArrowDown", "↓"], ["Minus", "-"], ["Equal", "="],
  ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\"],
  ["Semicolon", ";"], ["Quote", "'"], ["Comma", ","], ["Period", "."],
  ["Slash", "/"], ["Backquote", "`"],
]);

function keyLabel(code: string) {
  if (/^(?:Key[A-Z]|Digit[0-9])$/.test(code)) return code.at(-1);
  if (/^F(?:[1-9]|1[0-9]|20)$/.test(code)) return code;
  return specialKeys.get(code);
}

function formatShortcut(accelerator: string) {
  const parts = accelerator.split("+");
  const code = parts.pop() ?? "";
  const modifiers = modifierKeys.flatMap(([, name, label]) => parts.includes(name) ? [label] : []);
  return [...modifiers, keyLabel(code) ?? code].join(" ");
}

export default function PopoverShortcutControl({ shortcut, disabled, onChange }: {
  shortcut?: PopoverShortcut; disabled: boolean; onChange: (accelerator: string) => void;
}) {
  const hintId = useId();
  const [recording, setRecording] = useState(false);
  const label = formatShortcut(shortcut?.accelerator ?? defaultAccelerator);

  function record(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (event.key === "Tab" && !hasModifier) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !hasModifier) {
      setRecording(false);
      return;
    }
    if (!hasModifier || event.repeat || event.nativeEvent.isComposing || !keyLabel(event.code)) return;

    const modifiers = modifierKeys.flatMap(([property, name]) => event[property] ? [name] : []);
    setRecording(false);
    onChange([...modifiers, event.code].join("+"));
  }

  return <>
    <div className="menubar-settings-row menubar-action-row">
      <span>메뉴바 창 열기 단축키</span>
      {shortcut
        ? <button className="menubar-settings-button" type="button" disabled={disabled}
            aria-label={`메뉴바 창 열기 단축키 변경: ${label}`} aria-pressed={recording}
            aria-describedby={recording ? hintId : undefined} onClick={() => setRecording(value => !value)}
            onBlur={() => setRecording(false)} onKeyDown={record}>
            {recording ? "새 단축키 누르기…" : label}
          </button>
        : <kbd className="menubar-settings-button">{label}</kbd>}
    </div>
    {recording
      ? <p className="menubar-settings-note" id={hintId} role="status">⌃, ⌥, ⌘ 중 하나와 다른 키를 누르세요. Esc로 취소.</p>
      : shortcut?.registered === false && <p className="menubar-settings-note" role="status">현재 단축키를 사용할 수 없어요. 다른 조합을 선택하세요.</p>}
  </>;
}
