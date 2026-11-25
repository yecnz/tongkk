// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ReminderTimePicker from './ReminderTimePicker';

it.each([
  { start: '11:00', column: '시', direction: 1, ticks: 1, period: '오후', result: '12:00' },
  { start: '12:00', column: '시', direction: -1, ticks: 1, period: '오전', result: '11:00' },
  { start: '23:00', column: '시', direction: 1, ticks: 1, period: '오전', result: '00:00' },
  { start: '00:00', column: '시', direction: -1, ticks: 1, period: '오후', result: '23:00' },
  { start: '11:58', column: '분', direction: 1, ticks: 2, period: '오후', result: '12:00' },
  { start: '00:00', column: '분', direction: -1, ticks: 1, period: '오후', result: '23:59' },
])('scrolls $column from $start to $result and selects $period', async ({ start, column, direction, ticks, period, result }) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();

  try {
    await act(async () => root.render(h(ReminderTimePicker, { value: start, onChange, disabled: false, dark: false })));
    const trigger = container.querySelector('button')!;
    await act(async () => trigger.click());

    const wheel = container.querySelector(`[role="spinbutton"][aria-label="${column}"]`)!;
    await act(async () => {
      for (let tick = 0; tick < ticks; tick++) {
        wheel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: direction * 26 }));
      }
    });

    expect(container.querySelector('[aria-label="오전·오후"]')?.getAttribute('aria-valuetext')).toBe(period);
    await act(async () => trigger.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(result);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
