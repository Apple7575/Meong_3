import { createDog, listMyDogs } from './dogs';

const mockSingle = jest.fn();
const mockSelectAfterInsert = jest.fn(() => ({ single: mockSingle }));
const mockInsert = jest.fn(() => ({ select: mockSelectAfterInsert }));
const mockOrder = jest.fn();
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as (...args: any[]) => any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('createDog inserts with owner_id and returns row', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 'd1', name: '초코', owner_id: 'u1' }, error: null });
  const dog = await createDog({ name: '초코', gender: 'male' });
  expect(mockFrom).toHaveBeenCalledWith('dogs');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'u1', name: '초코', gender: 'male' }));
  expect(dog.id).toBe('d1');
});

test('listMyDogs queries by owner ordered by created_at', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 'd1' }], error: null });
  const dogs = await listMyDogs();
  expect(mockEq).toHaveBeenCalledWith('owner_id', 'u1');
  expect(dogs).toHaveLength(1);
});
