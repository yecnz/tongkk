import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './CustomSelect.css';

export type CustomSelectOption = { value: string | number; label: string; disabled?: boolean };
type Props = {
  value: string | number;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  id?: string;
  name?: string;
  required?: boolean;
};

export default function CustomSelect({ value, onChange, options, placeholder = '선택하세요', disabled = false,
  className = '', style, 'aria-label': label, id, name, required }: Props) {
  const generatedId = useId();
  const triggerId = id || `tongkk-select-${generatedId}`;
  const menuId = `${triggerId}-listbox`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = options.findIndex(option => String(option.value) === String(value));
  const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const unavailable = disabled || !available.length;
  const expanded = open && !unavailable;
  const activeIndex = available.includes(active) ? active : available[0];

  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node | null;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded || !portal) return;
    const button = trigger.current;
    const popup = menu.current;
    if (!button || !popup) return;

    const position = () => {
      const anchor = button.getBoundingClientRect();
      // The app scales #root with CSS zoom. A body portal and a dialog portal can
      // therefore have different coordinate systems; measure the popup's scale.
      const current = popup.getBoundingClientRect();
      const popupScale = popup.offsetWidth ? current.width / popup.offsetWidth : 1;
      const scale = popupScale || 1;
      const triggerScale = button.offsetWidth ? anchor.width / button.offsetWidth : scale;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const edge = 8;
      const gap = 6;
      const width = Math.min(Math.max(anchor.width, 1), Math.max(1, viewportWidth - edge * 2));
      const below = viewportTop + viewportHeight - anchor.bottom - gap - edge;
      const above = anchor.top - viewportTop - gap - edge;
      popup.style.width = `${width / scale}px`;
      popup.style.fontSize = `${(parseFloat(getComputedStyle(button).fontSize) || 14) * triggerScale / scale}px`;
      const desiredHeight = Math.min(popup.scrollHeight * scale || 280, 320 * triggerScale);
      const upward = below < desiredHeight && above > below;
      const room = Math.max(1, upward ? above : below);
      popup.style.maxHeight = `${Math.min(room, 320 * triggerScale) / scale}px`;
      const adjusted = popup.getBoundingClientRect();
      const left = Math.max(viewportLeft + edge, Math.min(anchor.left, viewportLeft + viewportWidth - width - edge));
      const top = upward ? Math.max(viewportTop + edge, anchor.top - gap - adjusted.height)
        : Math.max(viewportTop + edge, anchor.bottom + gap);
      popup.style.left = `${(parseFloat(popup.style.left) || 0) + (left - adjusted.left) / scale}px`;
      popup.style.top = `${(parseFloat(popup.style.top) || 0) + (top - adjusted.top) / scale}px`;
      popup.style.visibility = 'visible';
      popup.dataset.side = upward ? 'top' : 'bottom';
    };

    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(button);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      observer?.disconnect();
    };
  }, [expanded, portal, options]);

  useEffect(() => {
    if (expanded) document.getElementById(`${menuId}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, expanded, menuId]);

  function show(index = available.includes(selected) ? selected : available[0]) {
    if (unavailable) return;
    search.current = { text: '', at: 0 };
    setPortal(trigger.current?.closest<HTMLDialogElement>('dialog[open]') || document.body);
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || unavailable) return;
    if (String(option.value) !== String(value)) onChange(String(option.value));
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || unavailable) return;
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (expanded) choose(activeIndex); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const first = available[0];
      const last = available[available.length - 1];
      if (!expanded) show(event.key === 'Home' ? first : event.key === 'End' ? last
        : available.includes(selected) ? selected : event.key === 'ArrowUp' ? last : first);
      else {
        const next = available.indexOf(activeIndex) + (event.key === 'ArrowUp' ? -1 : 1);
        setActive(event.key === 'Home' ? first : event.key === 'End' ? last
          : available[Math.max(0, Math.min(available.length - 1, next))]);
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
      const query = [...text].every(character => character === text[0]) ? text[0] : text;
      const start = expanded ? activeIndex : selected;
      const match = options.map((_, offset) => (start + 1 + offset) % options.length)
        .find(index => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query));
      if (match !== undefined) { if (!expanded) show(match); else setActive(match); }
      search.current = { text, at: now };
    }
  }

  return <>
    <button ref={trigger} id={triggerId} type="button" role="combobox"
      className={`tongkk-select-trigger ${className}`.trim()} style={style} disabled={unavailable}
      aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-required={required || undefined}
      aria-controls={expanded ? menuId : undefined}
      aria-activedescendant={expanded && activeIndex !== undefined ? `${menuId}-option-${activeIndex}` : undefined}
      onKeyDownCapture={event => {
        if (expanded && event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        }
      }}
      onKeyDown={onKeyDown} onClick={() => expanded ? setOpen(false) : show()}>
      <span className={selected < 0 ? 'tongkk-select-placeholder' : undefined}>{options[selected]?.label ?? placeholder}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    {expanded && portal && createPortal(<ul ref={menu} id={menuId} className="tongkk-select-menu"
      role="listbox" aria-label={label} aria-labelledby={label ? undefined : triggerId}>
      {options.map((option, index) => <li key={String(option.value)} id={`${menuId}-option-${index}`}
        role="option" aria-selected={String(option.value) === String(value)} aria-disabled={option.disabled || undefined}
        className={`tongkk-select-option${activeIndex === index ? ' is-active' : ''}`}
        onMouseDown={event => event.preventDefault()}
        onPointerMove={() => { if (!option.disabled) setActive(index); }}
        onClick={event => { event.preventDefault(); choose(index); }}>
        <span>{option.label}</span><span aria-hidden="true" className="tongkk-select-check">{String(option.value) === String(value) ? '✓' : ''}</span>
      </li>)}
    </ul>, portal)}
  </>;
}
