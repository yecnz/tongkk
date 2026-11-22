import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export default function LearningSelect({ label, value, options, placeholder, disabled, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const items = [{ value: '', label: placeholder }, ...options];
  const selected = items.findIndex(item => item.value === value);
  const expanded = open && !disabled;

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, expanded, id]);

  function show(index = Math.max(0, selected)) {
    search.current = { text: '', at: 0 };
    setActive(index); setOpen(true);
  }
  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    onChange(item.value); setOpen(false); trigger.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (expanded) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!expanded) show(event.key === 'End' ? items.length - 1 : event.key === 'Home' ? 0 : Math.max(0, selected));
      else setActive(previous => event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const query = [...text].every(char => char === text[0]) ? text[0] : text;
      const start = expanded ? active : Math.max(0, selected);
      const index = items.findIndex((_, offset) => items[(start + 1 + offset) % items.length].label.toLocaleLowerCase().startsWith(query));
      if (index >= 0) { setActive((start + 1 + index) % items.length); setOpen(true); }
    }
  }

  return <div ref={root} className="learning-field learning-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <span id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" role="combobox" className="learning-select-trigger" disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
      onKeyDown={onKeyDown} onClick={() => expanded ? setOpen(false) : show()}>
      <span id={`${id}-value`} className={!value ? 'learning-muted' : undefined}>{items[selected]?.label || placeholder}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded && <ul id={`${id}-list`} className="learning-select-menu" role="listbox" aria-labelledby={`${id}-label`}>
      {items.map((item, index) => <li key={item.value} id={`${id}-option-${index}`} role="option" aria-selected={item.value === value}
        className={`learning-select-option${active === index ? ' is-active' : ''}`}
        onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{item.label}</span><span aria-hidden="true" className="learning-select-check">{item.value === value ? '✓' : ''}</span>
      </li>)}
    </ul>}
  </div>;
}
