import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}

describe('active_reports_in_bounds', () => {
  let viewer: Awaited<ReturnType<typeof makeUser>>;
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let center: { lat: number; lng: number };
  let activeId: string; let resolvedId: string; let farId: string;

  beforeAll(async () => {
    const t = Date.now();
    viewer = await makeUser(`v-${t}@t.dev`);
    owner = await makeUser(`o-${t}@t.dev`);
    // unique per-run center (remote band) so the envelope only contains this run's reports
    const hx = parseInt(owner.id.replace(/-/g, '').slice(0, 6), 16);
    center = { lat: 5 + (hx % 1000) / 100, lng: 160 + (hx % 1000) / 100 };
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    const dogId = (dog.data as any).id;
    const mk = async (lat: number, lng: number, status: string) => {
      const r = await admin.from('missing_reports').insert({
        owner_id: owner.id, dog_id: dogId, status,
        last_seen_point: `SRID=4326;POINT(${lng} ${lat})`, last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
      }).select('id').single();
      return (r.data as any).id;
    };
    activeId = await mk(center.lat, center.lng, 'active');
    resolvedId = await mk(center.lat, center.lng, 'resolved');     // same spot but resolved
    farId = await mk(center.lat + 1, center.lng + 1, 'active');    // ~111km away → outside the small envelope
  });

  test('returns active reports inside the envelope, excludes resolved and out-of-bounds', async () => {
    const d = 0.02; // ~2km half-box
    const { data, error } = await viewer.client.rpc('active_reports_in_bounds', {
      min_lng: center.lng - d, min_lat: center.lat - d, max_lng: center.lng + d, max_lat: center.lat + d,
    });
    expect(error).toBeNull();
    const ids = (data as any[]).map((x) => x.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(resolvedId); // resolved excluded
    expect(ids).not.toContain(farId);      // outside envelope excluded
    const row = (data as any[]).find((x) => x.id === activeId);
    expect(row.dog_name).toBe('초코');
    expect(typeof row.lat).toBe('number');
  });

  test('anonymous cannot call it (authenticated only)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await anon.rpc('active_reports_in_bounds', { min_lng: 0, min_lat: 0, max_lng: 1, max_lat: 1 });
    expect(error).not.toBeNull();
  });

  test('report_detail is locked: anon denied, authenticated still gets active report', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('report_detail', { p_id: activeId })).error).not.toBeNull(); // pre-existing leak closed
    const authed = await viewer.client.rpc('report_detail', { p_id: activeId }).single();
    expect(authed.error).toBeNull();
    expect((authed.data as any).id).toBe(activeId);
  });
});
