import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string, nickname: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').update({ nickname, phone: '01000000000' }).eq('id', data.user!.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (s.error) throw s.error;
  return { id: data.user!.id, client };
}

describe('chat RLS + RPC + closed', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let reporter: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let reportId: string; let chatId: string;

  beforeAll(async () => {
    const t = Date.now();
    owner = await makeUser(`o-${t}@t.dev`, '보호자');
    reporter = await makeUser(`r-${t}@t.dev`, '제보자');
    stranger = await makeUser(`s-${t}@t.dev`, '낯선이');
    const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
    const rep = await owner.client.from('missing_reports').insert({
      owner_id: owner.id, dog_id: (dog.data as any).id,
      last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
    }).select('id').single();
    reportId = (rep.data as any).id;
    // reporter files a sighting (precondition for chat)
    await reporter.client.from('sightings').insert({
      report_id: reportId, reporter_id: reporter.id,
      point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(),
    });
  });

  test('reporter can get_or_create_chat; owner gets the SAME chat (idempotent)', async () => {
    const r1 = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(r1.error).toBeNull();
    chatId = r1.data as string;
    const r2 = await owner.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(r2.data).toBe(chatId); // same thread
  });

  test('stranger cannot get_or_create_chat (no sighting / not authorized)', async () => {
    const r = await stranger.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: stranger.id });
    expect(r.error).not.toBeNull();
  });

  test('participants send + read; stranger denied; trigger bumps last_message_at', async () => {
    // controlled OLD timestamp so the trigger bump is observable as a STRICT increase (not a trivial >=)
    await admin.from('chats').update({ last_message_at: '2000-01-01T00:00:00Z' }).eq('id', chatId);
    const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: '봤어요!' });
    expect(ins.error).toBeNull();
    const ownerRead = await owner.client.from('messages').select('body').eq('chat_id', chatId);
    expect(ownerRead.data?.some((m: any) => m.body === '봤어요!')).toBe(true);
    const strangerRead = await stranger.client.from('messages').select('*').eq('chat_id', chatId);
    expect(strangerRead.data ?? []).toEqual([]);
    const after = (await admin.from('chats').select('last_message_at').eq('id', chatId).single()).data as any;
    expect(new Date(after.last_message_at).getTime()).toBeGreaterThan(new Date('2000-01-01T00:00:00Z').getTime());
  });

  test('stranger cannot send into a chat they are not in', async () => {
    const ins = await stranger.client.from('messages').insert({ chat_id: chatId, sender_id: stranger.id, body: 'hi' });
    expect(ins.error).not.toBeNull();
  });

  test('closed (resolved) report blocks new messages but allows reading', async () => {
    await owner.client.from('missing_reports').update({ status: 'resolved' }).eq('id', reportId);
    try {
      const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'late' });
      expect(ins.error).not.toBeNull(); // closed
      const read = await reporter.client.from('messages').select('body').eq('chat_id', chatId);
      expect((read.data ?? []).length).toBeGreaterThan(0); // history still readable
    } finally {
      await owner.client.from('missing_reports').update({ status: 'active' }).eq('id', reportId); // restore even if asserts fail
    }
  });

  test('owner cannot open a self-chat (reporter = owner)', async () => {
    const r = await owner.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: owner.id });
    expect(r.error).not.toBeNull();
  });

  test('anonymous cannot call chat RPCs (execute revoked)', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('my_chats')).error).not.toBeNull();
    expect((await anon.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id })).error).not.toBeNull();
  });

  test('my_chats returns the other participant nickname (no phone)', async () => {
    const r = await owner.client.rpc('my_chats');
    const row = (r.data as any[]).find((x) => x.chat_id === chatId);
    expect(row.other_nickname).toBe('제보자');
    expect(row.dog_name).toBe('초코');
    expect(row).not.toHaveProperty('phone');
  });
});
