import { createReport, listMyReports, resolveReport, countUsersNear } from './missingReports';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEqSel = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEqSel }));
const mockEqUpd = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEqUpd }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect, update: mockUpdate }));
const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    rpc: (...a: any[]) => (mockRpc as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('createReport inserts WKT point + owner + radius, returns id', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'r1' }, error: null });
  const id = await createReport({ dogId: 'd1', lat: 37.65, lng: 127.07, radiusM: 2000, lastSeenAt: 'iso', note: 'x' });
  expect(mockFrom).toHaveBeenCalledWith('missing_reports');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
    owner_id: 'u1', dog_id: 'd1', alert_radius_m: 2000,
    last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: 'iso',
  }));
  expect(id).toBe('r1');
});
test('resolveReport sets status resolved', async () => {
  mockEqUpd.mockResolvedValueOnce({ error: null });
  await resolveReport('r1');
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
  expect(mockEqUpd).toHaveBeenCalledWith('id', 'r1');
});
test('countUsersNear calls rpc', async () => {
  mockRpc.mockResolvedValueOnce({ data: 12, error: null });
  const n = await countUsersNear(37.65, 127.07, 2000);
  expect(mockRpc).toHaveBeenCalledWith('count_users_near', { lat: 37.65, lng: 127.07, radius_m: 2000 });
  expect(n).toBe(12);
});
test('listMyReports queries own ordered desc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null });
  const rows = await listMyReports();
  expect(mockEqSel).toHaveBeenCalledWith('owner_id', 'u1');
  expect(rows).toHaveLength(1);
});
