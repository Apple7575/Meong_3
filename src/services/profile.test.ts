import { getMyProfile, updateMyProfile } from './profile';

const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockUpdate = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) })) }));
const mockFrom = jest.fn(() => ({ select: mockSelect, update: mockUpdate }));

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as (...args: any[]) => any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } } )) },
  },
}));

beforeEach(() => jest.clearAllMocks());

test('getMyProfile reads profiles by current user id', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'u1', nickname: '철수', phone: '0101' }, error: null });
  const p = await getMyProfile();
  expect(mockFrom).toHaveBeenCalledWith('profiles');
  expect(p?.nickname).toBe('철수');
});

test('updateMyProfile throws on error', async () => {
  mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  await expect(updateMyProfile({ nickname: 'x', phone: '0101' })).rejects.toThrow('boom');
});
