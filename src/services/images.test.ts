import { buildImagePath } from './images';

jest.mock('../lib/supabase', () => ({ supabase: {} }));

test('buildImagePath nests under user/dog with jpg extension', () => {
  const path = buildImagePath('u1', 'd1', 'abc');
  expect(path).toBe('u1/d1/abc.jpg');
});
