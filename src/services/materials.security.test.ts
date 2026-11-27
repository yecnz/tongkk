import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), sign: vi.fn() }));
vi.mock('./supabase', () => ({ requireSupabaseUser: mocks.user, formatSupabaseError: () => 'error',
  supabase: { storage: { from: () => ({ createSignedUrl: mocks.sign }) } } }));
vi.mock('./courses', () => ({ fetchCourses: vi.fn() }));
vi.mock('./summaries', () => ({ deleteSummariesByMaterialId: vi.fn() }));
vi.mock('./summaryChats', () => ({ deleteChatSessionsByMaterialId: vi.fn() }));
import { createCourseMaterialFileUrl, invalidateMaterialsCache, type CourseMaterial } from './materials';
const material: CourseMaterial = { id: 'file', name: 'private.pdf', size: 10, type: 'pdf', pages: 1, slides: null,
  markdown: '', updatedAt: 1, filePath: 'alice/course/private.pdf' };
beforeEach(() => {
  vi.resetAllMocks(); invalidateMaterialsCache();
  mocks.user.mockResolvedValue({ id: 'alice' });
  mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.test/private?token=secret' }, error: null });
});
describe('private signed URLs', () => {
  it('never returns a cached bearer URL to another account', async () => {
    await createCourseMaterialFileUrl(material);
    mocks.user.mockResolvedValue({ id: 'bob' });
    await expect(createCourseMaterialFileUrl(material)).rejects.toThrow('접근');
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it('invalidates bearer URLs along with material lists on logout', async () => {
    await createCourseMaterialFileUrl(material);
    invalidateMaterialsCache();
    await createCourseMaterialFileUrl(material);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });
  it('rejects a signing response that completes after the user changes', async () => {
    mocks.user.mockResolvedValueOnce({ id: 'alice' }).mockResolvedValue({ id: 'bob' });
    await expect(createCourseMaterialFileUrl(material)).rejects.toThrow('변경');
    mocks.user.mockResolvedValue({ id: 'alice' });
    await createCourseMaterialFileUrl(material);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });
});
