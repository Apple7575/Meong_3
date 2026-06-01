import { getOrCreateChat, myChats, listMessages, sendMessage, subscribeToChat } from './chats';

const mockSingle = jest.fn();
const mockOrder = jest.fn();
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ select: mockSelect, insert: mockInsert }));
const mockRpc = jest.fn();
const mockOn = jest.fn(function (this: any) { return this; });
const mockSubscribe = jest.fn(function (this: any) { return this; });
const mockChannel = jest.fn(() => ({ on: mockOn, subscribe: mockSubscribe }));
const mockRemoveChannel = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    channel: (...a: any[]) => (mockChannel as any)(...a),
    removeChannel: (...a: any[]) => (mockRemoveChannel as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('getOrCreateChat calls rpc, returns chat id', async () => {
  mockRpc.mockResolvedValueOnce({ data: 'c1', error: null });
  const id = await getOrCreateChat('r1', 'rep1');
  expect(mockRpc).toHaveBeenCalledWith('get_or_create_chat', { p_report_id: 'r1', p_reporter_id: 'rep1' });
  expect(id).toBe('c1');
});
test('myChats calls rpc', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ chat_id: 'c1' }], error: null });
  const rows = await myChats();
  expect(mockRpc).toHaveBeenCalledWith('my_chats');
  expect(rows).toHaveLength(1);
});
test('listMessages selects by chat ordered by created_at', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'm1' }], error: null });
  const rows = await listMessages('c1');
  expect(mockFrom).toHaveBeenCalledWith('messages');
  expect(mockEq).toHaveBeenCalledWith('chat_id', 'c1');
  expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  expect(rows).toHaveLength(1);
});
test('sendMessage inserts trimmed body with sender = current user', async () => {
  mockInsert.mockResolvedValueOnce({ error: null });
  await sendMessage('c1', '  안녕  ');
  expect(mockInsert).toHaveBeenCalledWith({ chat_id: 'c1', sender_id: 'u1', body: '안녕' });
});
test('sendMessage rejects empty body before hitting the DB', async () => {
  await expect(sendMessage('c1', '   ')).rejects.toThrow();
  expect(mockInsert).not.toHaveBeenCalled();
});
test('subscribeToChat opens a channel filtered by chat_id and returns an unsubscribe', () => {
  const unsub = subscribeToChat('c1', () => {});
  expect(mockChannel).toHaveBeenCalledWith('chat:c1');
  expect(mockOn).toHaveBeenCalledWith('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: 'chat_id=eq.c1' }, expect.any(Function));
  unsub();
  expect(mockRemoveChannel).toHaveBeenCalled();
});
