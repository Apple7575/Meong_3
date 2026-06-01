import { upsertMyLocation } from './location';

const mockRpc = jest.fn();
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }));
beforeEach(() => jest.clearAllMocks());

test('calls upsert_my_location RPC with lat/lng', async () => {
  mockRpc.mockResolvedValueOnce({ error: null });
  await upsertMyLocation(37.65, 127.07);
  expect(mockRpc).toHaveBeenCalledWith('upsert_my_location', { lat: 37.65, lng: 127.07 });
});

test('throws on rpc error', async () => {
  mockRpc.mockResolvedValueOnce({ error: { message: 'nope' } });
  await expect(upsertMyLocation(1, 2)).rejects.toThrow('nope');
});
