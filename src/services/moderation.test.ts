import { hideSighting, blockUser, unblockUser, flagContent } from './moderation';

const mockRpc = jest.fn();
const mockInsert = jest.fn();
const mockEq2 = jest.fn();
const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
const mockDelete = jest.fn(() => ({ eq: mockEq1 }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, delete: mockDelete }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('hideSighting calls hide_sighting rpc with sighting id + flag', async () => {
  mockRpc.mockResolvedValueOnce({ error: null });
  await hideSighting('s1', true);
  expect(mockRpc).toHaveBeenCalledWith('hide_sighting', { p_sighting_id: 's1', p_hidden: true });
});

test('hideSighting throws on rpc error', async () => {
  mockRpc.mockResolvedValueOnce({ error: { message: 'not authorized' } });
  await expect(hideSighting('s1', true)).rejects.toThrow('not authorized');
});

test('blockUser inserts a block row for the current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await blockUser('b2');
  expect(mockFrom).toHaveBeenCalledWith('blocks');
  expect(mockInsert).toHaveBeenCalledWith({ blocker_id: 'u1', blocked_id: 'b2' });
});

test('unblockUser deletes the block row matching blocker+blocked', async () => {
  mockEq2.mockResolvedValueOnce({ error: null });
  await unblockUser('b2');
  expect(mockFrom).toHaveBeenCalledWith('blocks');
  expect(mockEq1).toHaveBeenCalledWith('blocker_id', 'u1');
  expect(mockEq2).toHaveBeenCalledWith('blocked_id', 'b2');
});

test('flagContent inserts a content_flags row under the current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await flagContent('message', 'm1', '욕설');
  expect(mockFrom).toHaveBeenCalledWith('content_flags');
  expect(mockInsert).toHaveBeenCalledWith({ content_type: 'message', content_id: 'm1', reporter_id: 'u1', reason: '욕설' });
});
