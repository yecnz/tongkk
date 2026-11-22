import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), find: vi.fn() }));
vi.mock('./summaries', () => ({ prepareSummaryIdentity: mocks.prepare, findReusableSummary: mocks.find }));
import { resolveSummaryRequest } from './summaryGeneration';
beforeEach(() => { mocks.prepare.mockReset(); mocks.find.mockReset(); mocks.prepare.mockResolvedValue({ request_key: 'key' }); });
it('finds completed output by exact prepared identity before generation', async () => {
  mocks.find.mockResolvedValue({ id: 'existing', content: '저장된 요약' });
  const result = await resolveSummaryRequest('과목', '원문', [{ id: 'a', name: '자료' }], 'GENERAL', {}, false);
  expect(result.existing?.content).toBe('저장된 요약'); expect(mocks.find).toHaveBeenCalledWith('과목', 'key');
});
it('regeneration bypasses output reuse while preserving request identity', async () => {
  const result = await resolveSummaryRequest('과목', '원문', [{ id: 'a', name: '자료' }], 'GENERAL', {}, true);
  expect(result.existing).toBeNull(); expect(result.identity.request_key).toBe('key'); expect(mocks.find).not.toHaveBeenCalled();
});
it('does not silently generate after identity validation or database failure', async () => {
  mocks.find.mockRejectedValue(new Error('DB unavailable'));
  await expect(resolveSummaryRequest('과목', '원문', [], 'GENERAL', {}, false)).rejects.toThrow('DB unavailable');
});
