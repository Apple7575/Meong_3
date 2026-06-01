import { createSighting, listSightingsForReport, buildSightingImagePath } from './sightings';

const mockSingle = jest.fn();
const mockInsert = jest.fn(() => ({ select: jest.fn(() => ({ single: mockSingle })) }));
const mockOrder = jest.fn();
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, select: mockSelect }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: any[]) => (mockFrom as any)(...a),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));
beforeEach(() => jest.clearAllMocks());

test('buildSightingImagePath nests reporter/sighting', () => {
  expect(buildSightingImagePath('u1', 's1', 'abc')).toBe('u1/s1/abc.jpg');
});
test('createSighting inserts WKT point + reporter + report', async () => {
  mockSingle.mockResolvedValueOnce({ data: { id: 's1' }, error: null });
  const id = await createSighting({ reportId: 'r1', lat: 37.6, lng: 127.0, seenAt: 'iso', note: 'n' });
  expect(mockFrom).toHaveBeenCalledWith('sightings');
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
    report_id: 'r1', reporter_id: 'u1', point: 'SRID=4326;POINT(127 37.6)', seen_at: 'iso',
  }));
  expect(id).toBe('s1');
});
test('listSightingsForReport orders by seen_at asc', async () => {
  mockOrder.mockResolvedValueOnce({ data: [{ id: 's1' }], error: null });
  const rows = await listSightingsForReport('r1');
  expect(mockEq).toHaveBeenCalledWith('report_id', 'r1');
  expect(mockOrder).toHaveBeenCalledWith('seen_at', { ascending: true });
  expect(rows).toHaveLength(1);
});
