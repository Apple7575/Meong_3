import { registerPushToken } from './push';

const mockUpsert = jest.fn();
const mockFrom = jest.fn(() => ({ upsert: mockUpsert }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => mockFrom(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('upserts token keyed on token column', async () => {
  mockUpsert.mockResolvedValueOnce({ error: null });
  await registerPushToken('tok-123', 'ios');
  expect(mockFrom).toHaveBeenCalledWith('fcm_tokens');
  expect(mockUpsert).toHaveBeenCalledWith(
    { user_id: 'u1', token: 'tok-123', platform: 'ios', last_seen_at: expect.any(String) },
    { onConflict: 'token' },
  );
});
