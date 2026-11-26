// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ModalDialog from './ModalDialog';
import CustomSelect from './CustomSelect';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});

function NestedDialogs() {
  const [parent, setParent] = useState(false);
  const [child, setChild] = useState(false);
  return <><button type="button" id="launch" onClick={() => setParent(true)}>열기</button>{parent &&
    <ModalDialog labelledBy="parent-title" onClose={() => setParent(false)}>
      <h2 id="parent-title">자료</h2><button type="button" id="delete" onClick={() => setChild(true)}>삭제</button>
      {child && <ModalDialog labelledBy="child-title" onClose={() => setChild(false)}>
        <h2 id="child-title">삭제 확인</h2><button type="button" onClick={() => setChild(false)}>취소</button>
      </ModalDialog>}
    </ModalDialog>}</>;
}

it('closes only the top dialog and restores focus and scrolling after the last dialog', async () => {
  document.body.style.overflow = 'auto';
  await act(async () => root.render(<NestedDialogs />));
  const launch = container.querySelector<HTMLButtonElement>('#launch')!;
  launch.focus();
  await act(async () => launch.click());
  expect(document.body.style.overflow).toBe('hidden');
  const remove = container.querySelector<HTMLButtonElement>('#delete')!;
  remove.focus();
  await act(async () => remove.click());
  const dialogs = container.querySelectorAll('dialog');
  expect(dialogs).toHaveLength(2);
  await act(async () => dialogs[1].dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true })));
  expect(container.querySelectorAll('dialog')).toHaveLength(1);
  expect(document.activeElement).toBe(remove);
  expect(document.body.style.overflow).toBe('hidden');
  await act(async () => dialogs[0].dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true })));
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(launch);
  expect(document.body.style.overflow).toBe('auto');
});

it('keeps the select popup inside the modal and Escape dismisses only the popup', async () => {
  const close = vi.fn();
  await act(async () => root.render(<ModalDialog labelledBy="select-title" onClose={close}>
    <h2 id="select-title">과목</h2><CustomSelect aria-label="과목" value="a" options={[{value:'a',label:'수학'},{value:'b',label:'영어'}]} onChange={() => {}} />
  </ModalDialog>));
  const trigger = container.querySelector<HTMLButtonElement>('[role=combobox]')!;
  trigger.focus();
  await act(async () => trigger.click());
  expect(container.querySelector('dialog [role=listbox]')).not.toBeNull();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  await act(async () => trigger.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(container.querySelector('[role=listbox]')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});
