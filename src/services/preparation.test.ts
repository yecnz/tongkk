import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), courses: vi.fn() }));
vi.mock('./workflow', () => ({ workflowRequest: mocks.request }));
vi.mock('./courses', () => ({ fetchCourses: mocks.courses }));
import { prepareUploadedMaterials } from './preparation';
it('does not schedule model work unless the user chose preparation', async () => {
  expect(await prepareUploadedMaterials('강의', [{ id: 'm', name: '자료' }], [])).toBe('');
  expect(mocks.request).not.toHaveBeenCalled();
});
it('preserves successful uploads and continues other preparation requests after a failure', async () => {
  mocks.courses.mockResolvedValue([{ id: 'course', name: '강의' }]);
  mocks.request.mockRejectedValueOnce(new Error('scope')).mockResolvedValueOnce({ id: 'prepared' });
  const message = await prepareUploadedMaterials('강의', [{ id: 'long', name: '긴 자료' }, { id: 'short', name: '짧은 자료' }], ['summary']);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(message).toContain('긴 자료'); expect(message).not.toContain('짧은 자료');
  expect(mocks.request.mock.calls[1][2]).toMatchObject({ course_id: 'course', material_id: 'short', kinds: ['summary'] });
});
