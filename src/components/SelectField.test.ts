// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SelectField from './SelectField';

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
const options = [{ value: 'a', label: '8장_판다스.pdf' }, { value: 'b', label: '9장_판다스.pdf' },
  { value: 'c', label: '10장_타이타닉데이터를분석하자.pdf' }];
function Field({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  return h(SelectField, { label: '자료', value, options, placeholder: '자료 선택', disabled,
    onChange: (next: string) => { changed(next); setValue(next); } });
}
const trigger = () => container.querySelector('[role=combobox]') as HTMLButtonElement;
async function key(value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  await act(async () => trigger().dispatchEvent(event));
  return event;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); changed.mockClear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('selects an option with the pointer and returns focus to the trigger', async () => {
  await act(async () => root.render(h(Field)));
  await act(async () => trigger().click());
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  const option = container.querySelectorAll('[role=option]')[2] as HTMLElement;
  await act(async () => option.click());
  expect(changed).toHaveBeenCalledWith('b');
  expect(trigger().textContent).toContain('9장_판다스.pdf');
  expect(container.querySelector('[role=listbox]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('supports keyboard navigation and confirms only on Enter', async () => {
  await act(async () => root.render(h(Field))); trigger().focus();
  await key('ArrowDown'); await key('End');
  expect(changed).not.toHaveBeenCalled();
  const active = document.getElementById(trigger().getAttribute('aria-activedescendant')!);
  expect(active?.textContent).toContain('10장_타이타닉');
  await key('Enter');
  expect(changed).toHaveBeenCalledWith('c');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
});

it('supports typing, Escape, Tab and outside dismissal without changing the selection', async () => {
  await act(async () => root.render(h(Field))); trigger().focus();
  await key('9');
  expect(document.getElementById(trigger().getAttribute('aria-activedescendant')!)?.textContent).toContain('9장_');
  await key('Escape'); expect(container.querySelector('[role=listbox]')).toBeNull();
  await key(' '); const tab = await key('Tab');
  expect(tab.defaultPrevented).toBe(false);
  expect(container.querySelector('[role=listbox]')).toBeNull();
  await key('ArrowDown');
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(container.querySelector('[role=listbox]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('prevents opening while disabled', async () => {
  await act(async () => root.render(h(Field, { disabled: true })));
  await act(async () => trigger().click());
  expect(trigger().disabled).toBe(true);
  expect(container.querySelector('[role=listbox]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});

it('keeps required selections limited to their real options', async () => {
  await act(async () => root.render(h(SelectField, { label: '가져오기 간격', value: 'b', options, onChange: changed })));
  trigger().focus(); await key('Home');
  expect(container.querySelectorAll('[role=option]')).toHaveLength(3);
  expect(container.querySelector('[aria-selected=true]')?.textContent).toContain('9장_');
  await key('Enter');
  expect(changed).toHaveBeenCalledWith('a');
});

it('allows clearing optional selections through their placeholder', async () => {
  await act(async () => root.render(h(SelectField, { label: '연결 과목', value: 'b', options, placeholder: '연결하지 않음', onChange: changed })));
  trigger().focus(); await key('Home'); await key('Enter');
  expect(changed).toHaveBeenCalledWith('');
});

it('shows an unavailable empty state when there are no options', async () => {
  await act(async () => root.render(h(SelectField, { label: '저장할 과목', value: '', options: [], onChange: changed })));
  expect(trigger().disabled).toBe(true);
  expect(trigger().textContent).toContain('선택할 항목이 없습니다');
  await act(async () => trigger().click());
  expect(container.querySelector('[role=listbox]')).toBeNull();
});
