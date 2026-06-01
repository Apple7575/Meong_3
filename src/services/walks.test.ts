import { saveWalk, listMyWalks, deleteWalk, getWalkStats } from './walks';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEqList = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEqList }));
const mockEqDelete = jest.fn();
const mockDelete = jest.fn(() => ({ eq: mockEqDelete }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect, delete: mockDelete }));
const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as (...x: any[]) => any)(...a),
    rpc: (...a: any[]) => (mockRpc as (...x: any[]) => any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('saveWalk inserts with user_id, dog_id, consent', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'w1' }, error: null });
  const id = await saveWalk({
    dogId: 'd9', routeGeojson: { type: 'LineString', coordinates: [] },
    distanceM: 1234, durationS: 600, startedAt: 'a', endedAt: 'b', useForMissingSearch: true,
  });
  expect(mockFrom).toHaveBeenCalledWith('walk_records');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', dog_id: 'd9', use_for_missing_search: true, distance_m: 1234 }));
  expect(id).toBe('w1');
});
test('listMyWalks selects with dog join, ordered desc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'w1', dog: { name: '초코' } }], error: null });
  const rows = await listMyWalks();
  expect(mockSelect).toHaveBeenCalledWith('*, dog:dogs(name)');
  expect(mockEqList).toHaveBeenCalledWith('user_id', 'u1');
  expect(mockOrder).toHaveBeenCalledWith('started_at', { ascending: false });
  expect(rows[0].dog?.name).toBe('초코');
});
test('deleteWalk by id', async () => {
  mockEqDelete.mockResolvedValueOnce({ error: null });
  await deleteWalk('w1');
  expect(mockEqDelete).toHaveBeenCalledWith('id', 'w1');
});
test('getWalkStats via RPC', async () => {
  mockRpc.mockReturnValueOnce({ single: jest.fn(async () => ({ data: { total_count: 3, current_streak: 2, total_distance_m: 10, this_week_count: 1 }, error: null })) });
  const s = await getWalkStats();
  expect(mockRpc).toHaveBeenCalledWith('my_walk_stats');
  expect(s.current_streak).toBe(2);
});
