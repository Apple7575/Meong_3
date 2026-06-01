import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildLogRows, invalidTokensFrom, recipientOf } from './fcm.ts';

Deno.test('buildLogRows maps send results to log rows', () => {
  assertEquals(buildLogRows('r1', [{ user_id: 'u1', token: 't1', ok: true }, { user_id: 'u2', token: 't2', ok: false }]), [
    { report_id: 'r1', user_id: 'u1', token: 't1', status: 'sent' },
    { report_id: 'r1', user_id: 'u2', token: 't2', status: 'failed' },
  ]);
});
Deno.test('invalidTokensFrom cleans only FcmError codes, ignores request-level errors', () => {
  assertEquals(invalidTokensFrom([
    { user_id: 'u1', token: 't1', ok: false, errorCode: undefined },
    { user_id: 'u2', token: 't2', ok: false, errorCode: 'UNREGISTERED' },
    { user_id: 'u3', token: 't3', ok: false, errorCode: 'INTERNAL' },
  ]), ['t2']);
});
Deno.test('recipientOf returns the non-sender participant, null for a non-participant', () => {
  const chat = { owner_id: 'o', reporter_id: 'r' };
  assertEquals(recipientOf(chat, 'o'), 'r');
  assertEquals(recipientOf(chat, 'r'), 'o');
  assertEquals(recipientOf(chat, 'x'), null);
});
