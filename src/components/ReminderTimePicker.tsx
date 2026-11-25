import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import chevronLight from "../assets/menubar-settings/time-chevron-light.svg";
import chevronDark from "../assets/menubar-settings/time-chevron-dark.svg";
import { formatMenubarTime } from "../services/menubarSettings";

const ROW_HEIGHT = 26;
const positions = [-2, -1, 0, 1, 2];
const range = (length: number) => Array.from({ length }, (_, index) => index);
const columns = [
  { label: "오전·오후", values: ["오전", "오후"], wraps: false },
  { label: "시", values: range(12).map(value => `${value || 12}시`), wraps: true },
  { label: "분", values: range(60).map(value => `${String(value).padStart(2, "0")}분`), wraps: true },
];
const wrap = (value: number, size: number) => ((value % size) + size) % size;

function WheelColumn({ column, value, setValue }: {
  column: typeof columns[number]; value: number; setValue: (next: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const wheelRemainder = useRef(0);
  const pointer = useRef<{ id: number; y: number; index: number; moved: boolean } | null>(null);

  const shift = (origin: number, steps: number) => {
    const next = origin + steps;
    setValue(column.wraps ? wrap(next, column.values.length) : Math.max(0, Math.min(column.values.length - 1, next)));
  };
  const shiftRef = useRef(shift);
  useEffect(() => { shiftRef.current = shift; });
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 130 : event.deltaY;
      wheelRemainder.current += delta;
      const steps = Math.trunc(wheelRemainder.current / ROW_HEIGHT);
      if (!steps) return;
      wheelRemainder.current -= steps * ROW_HEIGHT;
      shiftRef.current(Number(node.getAttribute("aria-valuenow")), steps);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    shift(value, event.key === "ArrowDown" ? 1 : -1);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer.current = { id: event.pointerId, y: event.clientY, index: value, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start?.id !== event.pointerId) return;
    if (Math.abs(start.y - event.clientY) > 6) start.moved = true;
    if (start.moved) shift(start.index, Math.round((start.y - event.clientY) / ROW_HEIGHT));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start?.id !== event.pointerId) return;
    pointer.current = null;
    if (start.moved) return;
    const top = event.currentTarget.getBoundingClientRect().top;
    shift(value, Math.max(-2, Math.min(2, Math.floor((event.clientY - top) / ROW_HEIGHT) - 2)));
  };

  return (
    <div ref={element} className="menubar-wheel-column" role="spinbutton" tabIndex={0}
      aria-label={column.label} aria-valuemin={0} aria-valuemax={column.values.length - 1}
      aria-valuenow={value} aria-valuetext={column.values[value]} onKeyDown={onKeyDown}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={() => { pointer.current = null; }}>
      {positions.map(position => (
        <span key={position} aria-hidden="true" data-distance={Math.abs(position)}>
          {column.values[column.wraps ? wrap(value + position, column.values.length) : value + position]}
        </span>
      ))}
    </div>
  );
}

export default function ReminderTimePicker({ value, onChange, disabled, dark }: {
  value: string; onChange: (value: string) => void; disabled: boolean; dark: boolean;
}) {
  const pickerId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const draft = useRef(value);
  const keyboardOpen = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const open = editing !== null;

  useEffect(() => {
    if (!open || !keyboardOpen.current) return;
    wrapper.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: globalThis.PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setEditing(null);
        if (draft.current !== value) onChange(draft.current);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [onChange, open, value]);

  function close(save: boolean) {
    setEditing(null);
    if (save && draft.current !== value) onChange(draft.current);
    trigger.current?.focus();
  }

  const [hour, minute] = (editing ?? value).split(":").map(Number);
  const values = [hour >= 12 ? 1 : 0, hour % 12, minute];
  function setPart(index: number, next: number) {
    const [currentHour, currentMinute] = draft.current.split(":").map(Number);
    const parts = [currentHour >= 12 ? 1 : 0, currentHour % 12, currentMinute];
    parts[index] = next;
    draft.current = [parts[0] * 12 + parts[1], parts[2]].map(part => String(part).padStart(2, "0")).join(":");
    setEditing(draft.current);
  }

  return (
    <div ref={wrapper} className="menubar-time-control" onKeyDown={event => {
      if (!open || (event.key !== "Enter" && event.key !== "Escape")) return;
      event.preventDefault();
      event.stopPropagation();
      close(event.key === "Enter");
    }}>
      <button ref={trigger} type="button" className="menubar-time-trigger" disabled={disabled}
        aria-label={`오늘 할 일 알림 시간: ${formatMenubarTime(editing ?? value)}`}
        aria-expanded={open} aria-controls={open ? pickerId : undefined}
        onClick={event => {
          if (open) close(true);
          else {
            keyboardOpen.current = event.detail === 0;
            draft.current = value;
            setEditing(value);
          }
        }}>
        {formatMenubarTime(editing ?? value)}<img src={dark ? chevronDark : chevronLight} alt="" />
      </button>
      {open && <div id={pickerId} className="menubar-time-wheel" role="group" aria-label="알림 시간 선택">
        {columns.map((column, index) => <WheelColumn key={column.label} column={column}
          value={values[index]} setValue={next => setPart(index, next)} />)}
      </div>}
    </div>
  );
}
