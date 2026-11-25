import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import chevronLight from "../assets/menubar-settings/time-chevron-light.svg";
import chevronDark from "../assets/menubar-settings/time-chevron-dark.svg";
import { formatMenubarTime } from "../services/menubarSettings";

const ROW_HEIGHT = 26;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_HALF_DAY = 12 * MINUTES_PER_HOUR;
const MINUTES_PER_DAY = 2 * MINUTES_PER_HALF_DAY;
const positions = [-2, -1, 0, 1, 2];
const range = (length: number) => Array.from({ length }, (_, index) => index);
const columns = [
  { label: "오전·오후", values: ["오전", "오후"], wraps: false, stepMinutes: MINUTES_PER_HALF_DAY },
  { label: "시", values: range(12).map(value => `${value || 12}시`), wraps: true, stepMinutes: MINUTES_PER_HOUR },
  { label: "분", values: range(60).map(value => `${String(value).padStart(2, "0")}분`), wraps: true, stepMinutes: 1 },
];
type TimeColumn = typeof columns[number];
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const columnValue = (time: number, column: TimeColumn) =>
  Math.floor(time / column.stepMinutes) % column.values.length;

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * MINUTES_PER_HOUR + minute;
}

function toTime(minutes: number) {
  const hour = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  return [hour, minute].map(part => String(part).padStart(2, "0")).join(":");
}

function WheelColumn({ column, time, onShift }: {
  column: TimeColumn; time: number; onShift: (steps: number, origin?: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const wheelRemainder = useRef(0);
  const pointer = useRef<{ id: number; y: number; time: number; moved: boolean } | null>(null);
  const value = columnValue(time, column);
  const shiftRef = useRef(onShift);
  useEffect(() => { shiftRef.current = onShift; });
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
      shiftRef.current(steps);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    onShift(event.key === "ArrowDown" ? 1 : -1);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer.current = { id: event.pointerId, y: event.clientY, time, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start?.id !== event.pointerId) return;
    if (Math.abs(start.y - event.clientY) > 6) start.moved = true;
    if (start.moved) onShift(Math.round((start.y - event.clientY) / ROW_HEIGHT), start.time);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start?.id !== event.pointerId) return;
    pointer.current = null;
    if (start.moved) return;
    const top = event.currentTarget.getBoundingClientRect().top;
    onShift(Math.max(-2, Math.min(2, Math.floor((event.clientY - top) / ROW_HEIGHT) - 2)));
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
  const savedTime = toMinutes(value);
  const draft = useRef(savedTime);
  const keyboardOpen = useRef(false);
  const [editing, setEditing] = useState<number | null>(null);
  const open = editing !== null;
  const time = editing ?? savedTime;
  const displayTime = formatMenubarTime(toTime(time));

  useEffect(() => {
    if (!open || !keyboardOpen.current) return;
    wrapper.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: globalThis.PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setEditing(null);
        if (draft.current !== savedTime) onChange(toTime(draft.current));
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [onChange, open, savedTime]);

  function close(save: boolean) {
    setEditing(null);
    if (save && draft.current !== savedTime) onChange(toTime(draft.current));
    trigger.current?.focus();
  }

  function shiftTime(column: TimeColumn, steps: number, origin = draft.current) {
    if (column.wraps) {
      draft.current = wrap(origin + steps * column.stepMinutes, MINUTES_PER_DAY);
    } else {
      const period = columnValue(origin, column);
      const next = Math.max(0, Math.min(column.values.length - 1, period + steps));
      draft.current = origin + (next - period) * column.stepMinutes;
    }
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
        aria-label={`오늘 할 일 알림 시간: ${displayTime}`}
        aria-expanded={open} aria-controls={open ? pickerId : undefined}
        onClick={event => {
          if (open) close(true);
          else {
            keyboardOpen.current = event.detail === 0;
            draft.current = savedTime;
            setEditing(savedTime);
          }
        }}>
        {displayTime}<img src={dark ? chevronDark : chevronLight} alt="" />
      </button>
      {open && <div id={pickerId} className="menubar-time-wheel" role="group" aria-label="알림 시간 선택">
        {columns.map(column => <WheelColumn key={column.label} column={column}
          time={time} onShift={(steps, origin) => shiftTime(column, steps, origin)} />)}
      </div>}
    </div>
  );
}
