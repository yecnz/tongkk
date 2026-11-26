// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CustomSelect from './CustomSelect';

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Charlie' }, { value: 4, label: 'Delta' }];
function Field({ disabled = false, dialog = false }: { disabled?: boolean; dialog?: boolean }) {
  const [value, setValue] = useState<string | number>('a');
  const field = <label>과목<CustomSelect aria-label="과목" name="course" value={value} options={options} disabled={disabled}
    onChange={next => { changed(next); setValue(next); }} /></label>;
  return <>{dialog ? <dialog open>{field}</dialog> : field}<button type="button">다음</button></>;
}
const trigger = () => container.querySelector('[role=combobox]') as HTMLButtonElement;
const listbox = () => document.querySelector('[role=listbox]') as HTMLElement | null;
const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') || '');
async function key(value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  await act(async () => trigger().dispatchEvent(event));
  return event;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changed.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('opens a body portal from an implicit label, selects a numeric value and restores trigger focus', async () => {
  await act(async () => root.render(<Field />));
  await act(async () => trigger().click());
  expect(listbox()?.parentElement).toBe(document.body);
  expect(trigger().getAttribute('aria-controls')).toBe(listbox()?.id);
  expect(document.querySelector('select')).toBeNull();
  await act(async () => (document.querySelectorAll('[role=option]')[3] as HTMLElement).click());
  expect(changed).toHaveBeenCalledExactlyOnceWith('4');
  expect(trigger().textContent).toContain('Delta');
  expect((container.querySelector('[name=course]') as HTMLInputElement).value).toBe('4');
  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('skips disabled options with arrows, Home and End and commits only after confirmation', async () => {
  await act(async () => root.render(<Field />));
  trigger().focus();
  await key('ArrowDown'); await key('ArrowDown');
  expect(active()?.textContent).toContain('Charlie');
  await key('End'); expect(active()?.textContent).toContain('Delta');
  await key('Home'); expect(active()?.textContent).toContain('Alpha');
  await key('ArrowUp'); expect(active()?.textContent).toContain('Alpha');
  await key('ArrowDown');
  expect(changed).not.toHaveBeenCalled();
  await key('Enter');
  expect(changed).toHaveBeenCalledExactlyOnceWith('c');
  expect(listbox()).toBeNull();
});

it('ignores disabled pointer options and supports typeahead without changing the selection on Escape', async () => {
  await act(async () => root.render(<Field />));
  trigger().focus();
  await key(' ');
  await act(async () => (document.querySelector('[aria-disabled=true]') as HTMLElement).click());
  expect(changed).not.toHaveBeenCalled();
  expect(listbox()).not.toBeNull();
  await key('c'); await key('h');
  expect(active()?.textContent).toContain('Charlie');
  const escape = await key('Escape');
  expect(escape.defaultPrevented).toBe(true);
  expect(listbox()).toBeNull();
  expect(trigger().textContent).toContain('Alpha');
  expect(changed).not.toHaveBeenCalled();
});

it('dismisses on Tab, focus changes and outside pointers without trapping focus', async () => {
  await act(async () => root.render(<Field />));
  trigger().focus();
  await key(' ');
  const tab = await key('Tab');
  expect(tab.defaultPrevented).toBe(false);
  expect(listbox()).toBeNull();
  await key(' ');
  await act(async () => (container.querySelector('button:not([role])') as HTMLButtonElement).focus());
  expect(listbox()).toBeNull();
  await key(' ');
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(listbox()).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('keeps the popup inside the current dialog and consumes Escape before the dialog handler', async () => {
  await act(async () => root.render(<Field dialog />));
  const dialog = container.querySelector('dialog')!;
  const dialogKey = vi.fn();
  dialog.addEventListener('keydown', dialogKey);
  await act(async () => trigger().click());
  expect(listbox()?.parentElement).toBe(dialog);
  await key('Escape');
  expect(dialogKey).not.toHaveBeenCalled();
  expect(dialog.open).toBe(true);
});

it('cannot open while disabled and closes an existing popup when disabled', async () => {
  await act(async () => root.render(<Field />));
  await act(async () => trigger().click());
  expect(listbox()).not.toBeNull();
  await act(async () => root.render(<Field disabled />));
  expect(listbox()).toBeNull();
  expect(trigger().disabled).toBe(true);
  await act(async () => trigger().click());
  expect(listbox()).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('flips above the trigger when the viewport has insufficient space below', async () => {
  await act(async () => root.render(<Field />));
  vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ x: 100, y: 700, left: 100, top: 700,
    bottom: 740, right: 300, width: 200, height: 40, toJSON() {} });
  await act(async () => trigger().click());
  expect(listbox()?.dataset.side).toBe('top');
  expect(listbox()?.style.visibility).toBe('visible');
  expect(parseFloat(listbox()?.style.width || '0')).toBe(200);
});
