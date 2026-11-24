import { useId, useRef } from "react";

type MiniSelectProps = {
  label: string;
  placeholder: string;
  value: string;
  options: { value: string; label: string }[];
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
};

// 목록을 카드 안에서 펼쳐 macOS 기본 select의 별도 팝업을 피한다.
export default function MiniSelect({ label, placeholder, value, options, expanded, disabled, onToggle, onChange }: MiniSelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  return (
    <div className="mini-select-field">
      <span id={`${id}-label`} className="mini-select-label">{label}</span>
      <div className="mini-select" onKeyDown={event => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          onToggle();
          triggerRef.current?.focus();
        }
      }}>
        <button ref={triggerRef} type="button" className="mini-select-toggle" disabled={disabled || options.length === 0} aria-labelledby={`${id}-label ${id}-value`} aria-expanded={expanded} aria-controls={`${id}-options`} onClick={onToggle}>
          <span id={`${id}-value`} className={selected ? "" : "mini-select-placeholder"}>{selected?.label || placeholder}</span>
          <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
        </button>
        {expanded && <div id={`${id}-options`} className="mini-select-options" role="group" aria-labelledby={`${id}-label`}>
          {options.map(option => <button type="button" key={option.value} title={option.label} aria-pressed={value === option.value} onClick={() => { onChange(option.value); triggerRef.current?.focus(); }}>{option.label}</button>)}
        </div>}
      </div>
    </div>
  );
}
