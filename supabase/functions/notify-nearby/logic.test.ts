import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildLogRows, invalidTokensFrom, buildFcmMessage } from './logic.ts';

Deno.test('buildLogRows maps send results to log rows', () => {
  const rows = buildLogRows('r1', [
    { user_id: 'u1', token: 't1', ok: true },
    { user_id: 'u2', token: 't2', ok: false },
  ]);
  assertEquals(rows, [
    { report_id: 'r1', user_id: 'u1', token: 't1', status: 'sent' },
    { report_id: 'r1', user_id: 'u2', token: 't2', status: 'failed' },
  ]);
});
Deno.test('invalidTokensFrom collects tokens FCM rejected as unregistered', () => {
  const bad = invalidTokensFrom([
    { user_id: 'u1', token: 't1', ok: true, errorCode: undefined },
    { user_id: 'u2', token: 't2', ok: false, errorCode: 'UNREGISTERED' },
    { user_id: 'u3', token: 't3', ok: false, errorCode: 'INTERNAL' },
  ]);
  assertEquals(bad, ['t2']); // only UNREGISTERED/INVALID_ARGUMENT-style get cleaned
});
Deno.test('invalidTokensFrom ignores failures with no FCM errorCode (request-level errors)', () => {
  const bad = invalidTokensFrom([
    { user_id: 'u1', token: 't1', ok: false, errorCode: undefined },          // request-level error, no FcmError detail → keep token
    { user_id: 'u2', token: 't2', ok: false, errorCode: 'INVALID_ARGUMENT' }, // FcmError detail → clean
  ]);
  assertEquals(bad, ['t2']);
});
Deno.test('buildFcmMessage data values are strings (FCM v1 requires string data)', () => {
  const m = buildFcmMessage('tok', { id: 'r1', dogName: '초코' }) as any;
  assertEquals(typeof m.message.data.report_id, 'string');
  assertEquals(typeof m.message.data.type, 'string');
});
