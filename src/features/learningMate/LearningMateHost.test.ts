// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: { id: 'user' }, request: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.request }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '운영체제' }] }));
vi.mock('../../components/AITutorDrawer', () => ({
  AITutorDrawer: ({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) =>
    h('button', { type: 'button', 'aria-label': 'AI 튜터 닫기', onClick: () => onOpenChange?.(false) }, '닫기'),
}));
import LearningMateHost from './LearningMateHost';
import { LearningScopeContext } from './context';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.request.mockReset().mockResolvedValue({ courseId: 'course', materialId: 'material', sourceHash: 'v1', title: '스레드' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each(['학습 메이트 닫기', 'AI 튜터 닫기'])('closes the panel with %s and restores launcher focus', async label => {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/summary'] },
    h(LearningScopeContext.Provider, { value: { scope: { courseId: 'course', materialId: 'material', title: '스레드' }, register: () => {} } },
      h(LearningMateHost)))));
  const launcher = container.querySelector<HTMLButtonElement>('.learning-mate-launch')!;
  await act(async () => launcher.click());
  expect(container.querySelector('#learning-mate-panel')).toBeTruthy();
  expect(launcher.getAttribute('aria-expanded')).toBe('true');
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  expect(container.querySelector('#learning-mate-panel')).toBeNull();
  expect(launcher.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(launcher);
});
