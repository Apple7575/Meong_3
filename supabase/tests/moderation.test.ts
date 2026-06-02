import { createClient } from '@supabase/supabase-js';

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

// Build an active report owned by `owner` with one sighting filed by `reporter`, returns ids.
async function makeReportWithSighting(owner: any, reporter: any) {
  const dog = await owner.client.from('dogs').insert({ owner_id: owner.id, name: '초코' }).select('id').single();
  const rep = await owner.client.from('missing_reports').insert({
    owner_id: owner.id, dog_id: (dog.data as any).id,
    last_seen_point: 'SRID=4326;POINT(127.07 37.65)', last_seen_at: new Date().toISOString(), alert_radius_m: 2000,
  }).select('id').single();
  const reportId = (rep.data as any).id;
  const sight = await reporter.client.from('sightings').insert({
    report_id: reportId, reporter_id: reporter.id,
    point: 'SRID=4326;POINT(127.071 37.651)', seen_at: new Date().toISOString(),
  }).select('id').single();
  return { reportId, sightingId: (sight.data as any).id };
}

describe('SP3c expiry + moderation', () => {
  test('expire_old_reports flips past-due active reports to expired and closes their chats', async () => {
    const t = Date.now();
    const owner = await makeUser(`exp-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`exp-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    // make it past-due and open a chat while still active
    await admin.from('missing_reports').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', reportId);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(chat.error).toBeNull();
    const chatId = chat.data as string;

    const r = await admin.rpc('expire_old_reports');
    expect(r.error).toBeNull();
    const row = (await admin.from('missing_reports').select('status').eq('id', reportId).single()).data as any;
    expect(row.status).toBe('expired');
    // chat is now read-only (messages_insert requires status='active')
    const ins = await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'late' });
    expect(ins.error).not.toBeNull();
    // idempotent: a second run leaves the already-expired row untouched (no error, still expired)
    expect((await admin.rpc('expire_old_reports')).error).toBeNull();
    const again = (await admin.from('missing_reports').select('status').eq('id', reportId).single()).data as any;
    expect(again.status).toBe('expired');
  });

  test('expire_old_reports does not touch non-active or not-yet-due reports', async () => {
    const t = Date.now();
    const owner = await makeUser(`exp2-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`exp2-r-${t}@t.dev`, '제보자');
    // a future-dated active report (not due) and a resolved past-due report (already closed)
    const future = await makeReportWithSighting(owner, reporter);
    await admin.from('missing_reports').update({ expires_at: '2999-01-01T00:00:00Z' }).eq('id', future.reportId);
    const resolved = await makeReportWithSighting(owner, reporter);
    await admin.from('missing_reports').update({ status: 'resolved', expires_at: '2000-01-01T00:00:00Z' }).eq('id', resolved.reportId);

    expect((await admin.rpc('expire_old_reports')).error).toBeNull();
    const futureRow = (await admin.from('missing_reports').select('status').eq('id', future.reportId).single()).data as any;
    expect(futureRow.status).toBe('active'); // not due -> untouched
    const resolvedRow = (await admin.from('missing_reports').select('status').eq('id', resolved.reportId).single()).data as any;
    expect(resolvedRow.status).toBe('resolved'); // not active -> resolved is NOT overwritten with expired
  });

  test('purge_old_notification_logs deletes rows older than 30 days, keeps recent', async () => {
    const t = Date.now();
    const owner = await makeUser(`pur-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`pur-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const oldLog = await admin.from('notification_logs').insert({
      report_id: reportId, user_id: reporter.id, token: 'tok-old', status: 'sent', created_at: '2000-01-01T00:00:00Z',
    }).select('id').single();
    const newLog = await admin.from('notification_logs').insert({
      report_id: reportId, user_id: reporter.id, token: 'tok-new', status: 'sent',
    }).select('id').single();

    const r = await admin.rpc('purge_old_notification_logs');
    expect(r.error).toBeNull();
    const oldGone = await admin.from('notification_logs').select('id').eq('id', (oldLog.data as any).id);
    expect(oldGone.data ?? []).toEqual([]);
    const newKept = await admin.from('notification_logs').select('id').eq('id', (newLog.data as any).id);
    expect((newKept.data ?? []).length).toBe(1);
  });

  test('hide_sighting: owner hides -> excluded from report_sightings; non-owner denied', async () => {
    const t = Date.now();
    const owner = await makeUser(`hid-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`hid-r-${t}@t.dev`, '제보자');
    const { reportId, sightingId } = await makeReportWithSighting(owner, reporter);

    // reporter (non-owner) cannot hide
    const denied = await reporter.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: true });
    expect(denied.error).not.toBeNull();

    // owner hides -> gone from report_sightings (for both owner and reporter views)
    const ok = await owner.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: true });
    expect(ok.error).toBeNull();
    const ownerView = await owner.client.rpc('report_sightings', { p_report_id: reportId });
    expect((ownerView.data as any[]).some((s) => s.id === sightingId)).toBe(false);
    const reporterView = await reporter.client.rpc('report_sightings', { p_report_id: reportId });
    expect((reporterView.data as any[]).some((s) => s.id === sightingId)).toBe(false);

    // un-hide restores it
    await owner.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: false });
    const restored = await owner.client.rpc('report_sightings', { p_report_id: reportId });
    expect((restored.data as any[]).some((s) => s.id === sightingId)).toBe(true);
  });

  test('hiding a sighting does NOT break chat eligibility (get_or_create_chat keys off raw sightings)', async () => {
    const t = Date.now();
    const owner = await makeUser(`hidc-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`hidc-r-${t}@t.dev`, '제보자');
    const { reportId, sightingId } = await makeReportWithSighting(owner, reporter);
    await owner.client.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: true });
    // reporter still has a (hidden) sighting on the report, so chat creation must still succeed
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    expect(chat.error).toBeNull();
  });

  test('block: A blocks B -> messages denied both ways + thread hidden from A my_chats', async () => {
    const t = Date.now();
    const owner = await makeUser(`blk-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`blk-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    const chatId = chat.data as string;
    // baseline: reporter can send
    expect((await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'hi' })).error).toBeNull();

    // owner blocks reporter
    expect((await owner.client.from('blocks').insert({ blocker_id: owner.id, blocked_id: reporter.id })).error).toBeNull();

    // neither side can send now (bidirectional guard)
    expect((await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'again' })).error).not.toBeNull();
    expect((await owner.client.from('messages').insert({ chat_id: chatId, sender_id: owner.id, body: 'reply' })).error).not.toBeNull();

    // thread excluded from the blocker's my_chats; still present for the blocked user
    const ownerChats = await owner.client.rpc('my_chats');
    expect((ownerChats.data as any[]).some((c) => c.chat_id === chatId)).toBe(false);
    const reporterChats = await reporter.client.rpc('my_chats');
    expect((reporterChats.data as any[]).some((c) => c.chat_id === chatId)).toBe(true);
  });

  test('block (reverse direction): reporter blocks owner -> both sends denied', async () => {
    const t = Date.now();
    const owner = await makeUser(`blkr-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`blkr-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    const chatId = chat.data as string;
    // reporter (not owner) blocks owner
    expect((await reporter.client.from('blocks').insert({ blocker_id: reporter.id, blocked_id: owner.id })).error).toBeNull();
    // guard is bidirectional regardless of who blocked whom
    expect((await owner.client.from('messages').insert({ chat_id: chatId, sender_id: owner.id, body: 'x' })).error).not.toBeNull();
    expect((await reporter.client.from('messages').insert({ chat_id: chatId, sender_id: reporter.id, body: 'y' })).error).not.toBeNull();
  });

  test('my_chats exposes other_id (the other participant)', async () => {
    const t = Date.now();
    const owner = await makeUser(`oid-o-${t}@t.dev`, '보호자');
    const reporter = await makeUser(`oid-r-${t}@t.dev`, '제보자');
    const { reportId } = await makeReportWithSighting(owner, reporter);
    const chat = await reporter.client.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporter.id });
    const chatId = chat.data as string;
    const ownerChats = await owner.client.rpc('my_chats');
    const row = (ownerChats.data as any[]).find((c) => c.chat_id === chatId);
    expect(row.other_id).toBe(reporter.id);
  });

  test('content_flags: own insert allowed; impersonating another reporter denied', async () => {
    const t = Date.now();
    const user = await makeUser(`flg-${t}@t.dev`, '신고자');
    const other = await makeUser(`flg2-${t}@t.dev`, '타인');
    const ok = await user.client.from('content_flags').insert({
      content_type: 'message', content_id: '00000000-0000-0000-0000-000000000001', reporter_id: user.id, reason: '욕설',
    });
    expect(ok.error).toBeNull();
    const denied = await user.client.from('content_flags').insert({
      content_type: 'sighting', content_id: '00000000-0000-0000-0000-000000000002', reporter_id: other.id, reason: 'spoof',
    });
    expect(denied.error).not.toBeNull();
  });

  test('expiry/purge functions are locked to service_role (anon AND authenticated denied)', async () => {
    const t = Date.now();
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('expire_old_reports')).error).not.toBeNull();
    expect((await anon.rpc('purge_old_notification_logs')).error).not.toBeNull();
    // a signed-in (authenticated) user must also be denied — only service_role / cron may run these
    const user = await makeUser(`lock-${t}@t.dev`, '잠금');
    expect((await user.client.rpc('expire_old_reports')).error).not.toBeNull();
    expect((await user.client.rpc('purge_old_notification_logs')).error).not.toBeNull();
    // hide_sighting is authenticated-only: anon denied at the execute level
    expect((await anon.rpc('hide_sighting', { p_sighting_id: '00000000-0000-0000-0000-000000000001', p_hidden: true })).error).not.toBeNull();
  });
});
