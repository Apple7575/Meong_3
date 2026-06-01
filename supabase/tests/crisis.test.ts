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
// admin RPC to set a user's location (bypasses RLS via service role calling the RPC as that user is not possible;
// instead insert user_locations directly with admin)
async function setLocation(userId: string, lat: number, lng: number) {
  const { error } = await admin.from('user_locations')
    .upsert({ user_id: userId, geom: `SRID=4326;POINT(${lng} ${lat})`, updated_at: new Date().toISOString() });
  if (error) throw error;
}

describe('crisis RLS + radius', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let near: Awaited<ReturnType<typeof makeUser>>;
  let far: Awaited<ReturnType<typeof makeUser>>;
  let dogId: string; let reportId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    owner = await makeUser(`own-${stamp}@t.dev`);
    near = await makeUser(`near-${stamp}@t.dev`);
    far = await makeUser(`far-${stamp}@t.dev`);
    // dog owned by owner
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    dogId = (dog.data as any).id;
    // locations: owner + near within radius of (37.65,127.07), far ~5km away
    await setLocation(owner.id, 37.650, 127.070);
    await setLocation(near.id, 37.651, 127.071);
    await setLocation(far.id, 37.70, 127.13);
    // tokens for ALL three so owner-exclusion (by owner_id) and far-exclusion (out of radius) are actually exercised
    await admin.from('fcm_tokens').insert([
      { user_id: owner.id, token: `tok-own-${stamp}`, platform: 'ios' },
      { user_id: near.id, token: `tok-near-${stamp}`, platform: 'ios' },
      { user_id: far.id, token: `tok-far-${stamp}`, platform: 'ios' },
    ]);
    // owner creates active report, radius 2000m at (37.65,127.07)
    const rep = await owner.client.from('missing_reports').insert({
      owner_id: owner.id, dog_id: dogId,
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)',
      last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    }).select('id').single();
    reportId = (rep.data as any).id;
  });

  test('neighbor can read an ACTIVE report and the linked dog', async () => {
    const r = await near.client.from('missing_reports').select('id,status').eq('id', reportId).single();
    expect(r.data?.status).toBe('active');
    const d = await near.client.from('dogs').select('name').eq('id', dogId).single();
    expect(d.data?.name).toBe('초코');
  });

  test('neighbor canNOT read a RESOLVED report', async () => {
    await owner.client.from('missing_reports').update({ status: 'resolved' }).eq('id', reportId);
    const r = await near.client.from('missing_reports').select('id').eq('id', reportId);
    expect(r.data).toEqual([]);
    await owner.client.from('missing_reports').update({ status: 'active' }).eq('id', reportId); // restore
  });

  test('neighbor can insert a sighting on active report; far cannot read others sightings', async () => {
    const ins = await near.client.from('sightings').insert({
      report_id: reportId, reporter_id: near.id,
      point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(), note: '봤어요',
    });
    expect(ins.error).toBeNull();
    const farView = await far.client.from('sightings').select('*').eq('report_id', reportId);
    expect(farView.data).toEqual([]); // far is neither reporter nor owner
    const ownerView = await owner.client.from('sightings').select('*').eq('report_id', reportId);
    expect(ownerView.data?.length).toBe(1); // owner sees it
  });

  test('count_users_near excludes caller, counts only within radius', async () => {
    // owner previews reach at the report point with 2km: near(in) counts, far(out) excluded, owner(self) excluded
    const { data, error } = await owner.client.rpc('count_users_near', { lat: 37.65, lng: 127.07, radius_m: 2000 });
    expect(error).toBeNull();
    expect(data).toBe(1);
  });

  test('tokens_near_report returns nearby non-owner tokens (owner+far have tokens too, must be excluded)', async () => {
    const { data, error } = await admin.rpc('tokens_near_report', { p_report_id: reportId });
    expect(error).toBeNull();
    expect((data as any[]).some((row) => row.user_id === near.id)).toBe(true);  // in radius
    expect((data as any[]).some((row) => row.user_id === owner.id)).toBe(false); // excluded by owner_id (even though in radius + has token)
    expect((data as any[]).some((row) => row.user_id === far.id)).toBe(false);   // out of radius (even though has token)
  });

  test('anonymous (signed-out) cannot read active reports (TO authenticated)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await anon.from('missing_reports').select('id').eq('id', reportId);
    expect(data ?? []).toEqual([]);
  });

  test('cannot create a report for a dog you do not own', async () => {
    const { error } = await near.client.from('missing_reports').insert({
      owner_id: near.id, dog_id: dogId, // owner's dog, not near's
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    });
    expect(error).not.toBeNull(); // mr_insert with-check requires dog ownership
  });

  test('clients cannot call tokens_near_report (execute revoked)', async () => {
    const { error } = await near.client.rpc('tokens_near_report', { p_report_id: reportId });
    expect(error).not.toBeNull();
  });
});
