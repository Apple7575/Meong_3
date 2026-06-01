import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}
async function insertWalk(userId: string, startedAt: string, distanceM = 1000) {
  const { error } = await admin.from('walk_records').insert({
    user_id: userId, dog_id: null,
    route_geojson: { type: 'LineString', coordinates: [[127, 37], [127.001, 37.001]] },
    distance_m: distanceM, duration_s: 600, started_at: startedAt, ended_at: startedAt,
  });
  if (error) throw error;
}
function kstNoonNDaysAgo(n: number): string {
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear(), m = kstNow.getUTCMonth(), d = kstNow.getUTCDate();
  const utcMs = Date.UTC(y, m, d - n, 3, 0, 0);
  return new Date(utcMs).toISOString();
}
describe('walk_records RLS + my_walk_stats', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };
  beforeAll(async () => {
    const stamp = Date.now();
    alice = await makeUser(`wa-${stamp}@test.dev`);
    bob = await makeUser(`wb-${stamp}@test.dev`);
    await insertWalk(alice.id, kstNoonNDaysAgo(0), 1500);
    await insertWalk(alice.id, kstNoonNDaysAgo(1), 1000);
    await insertWalk(alice.id, kstNoonNDaysAgo(2), 500);
    await insertWalk(alice.id, kstNoonNDaysAgo(10), 2000);
  });
  test('alice cannot see bob walks (RLS)', async () => {
    await insertWalk(bob.id, kstNoonNDaysAgo(0));
    const { data } = await alice.client.from('walk_records').select('*');
    expect(data?.every((w: any) => w.user_id === alice.id)).toBe(true);
  });
  test('my_walk_stats totals + streak', async () => {
    const { data, error } = await alice.client.rpc('my_walk_stats').single();
    expect(error).toBeNull();
    const s = data as any;
    expect(s.total_count).toBe(4);
    expect(s.total_distance_m).toBeCloseTo(5000, 0);
    expect(s.current_streak).toBe(3);
  });
});
