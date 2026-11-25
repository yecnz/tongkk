// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import PopoverShortcutControl from './PopoverShortcutControl';

it('records a modified key combination and lets Escape cancel a new recording', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(async () => root.render(h(PopoverShortcutControl, {
      shortcut: { accelerator: 'alt+super+KeyT', registered: true }, disabled: false, onChange,
    })));
    const button = container.querySelector('button')!;
    const press = (key: KeyboardEventInit) => act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...key }));
    });
    expect(button.textContent).toBe('⌥ ⌘ T');
    await act(async () => button.click());
    await press({ key: 'k', code: 'KeyK' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    await press({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('control+shift+KeyK');
    await act(async () => button.click());
    await press({ key: 'Escape', code: 'Escape' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
