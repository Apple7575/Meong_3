import { flyerUrl, shareMessage } from './flyer';

test('flyerUrl builds the public function URL', () => {
  expect(flyerUrl('https://abc.supabase.co', 'r1')).toBe('https://abc.supabase.co/functions/v1/flyer?report=r1');
  expect(flyerUrl('https://abc.supabase.co/', 'r1')).toBe('https://abc.supabase.co/functions/v1/flyer?report=r1'); // trailing slash tolerated
});
test('shareMessage includes dog name and url', () => {
  const m = shareMessage('초코', 'https://abc.supabase.co/functions/v1/flyer?report=r1');
  expect(m).toContain('초코');
  expect(m).toContain('https://abc.supabase.co/functions/v1/flyer?report=r1');
});
