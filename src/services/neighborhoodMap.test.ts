import { reportsInBounds } from './neighborhoodMap';

const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => (mockRpc as any)(...a) } }));
beforeEach(() => jest.clearAllMocks());

test('reportsInBounds calls active_reports_in_bounds with lng/lat envelope', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ id: 'r1', lat: 37, lng: 127, dog_name: '초코', last_seen_at: 'iso', photo_path: null }], error: null });
  const rows = await reportsInBounds({ minLng: 127.0, minLat: 37.6, maxLng: 127.1, maxLat: 37.7 });
  expect(mockRpc).toHaveBeenCalledWith('active_reports_in_bounds', { min_lng: 127.0, min_lat: 37.6, max_lng: 127.1, max_lat: 37.7 });
  expect(rows[0].dog_name).toBe('초코');
});
test('throws on rpc error', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  await expect(reportsInBounds({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 })).rejects.toThrow('boom');
});
