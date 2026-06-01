import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type SendResult = { user_id: string; token: string; ok: boolean; errorCode?: string };
export type LogRow = { report_id: string; user_id: string; token: string; status: 'sent' | 'failed' };

export function buildLogRows(reportId: string, results: SendResult[]): LogRow[] {
  return results.map((r) => ({ report_id: reportId, user_id: r.user_id, token: r.token, status: r.ok ? 'sent' : 'failed' }));
}
const CLEANUP_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
export function invalidTokensFrom(results: SendResult[]): string[] {
  return results.filter((r) => !r.ok && r.errorCode && CLEANUP_CODES.has(r.errorCode)).map((r) => r.token);
}

/** Pull the token-cleanup code ONLY from a genuine FcmError detail — never a request-level error.status. */
export function extractFcmErrorCode(errBody: unknown): string | undefined {
  const details = (errBody as any)?.error?.details ?? [];
  return details.find(
    (d: any) => typeof d?.['@type'] === 'string' && d['@type'].includes('FcmError') && typeof d?.errorCode === 'string',
  )?.errorCode;
}

/** The chat participant who is NOT the sender. null if the sender isn't a participant. */
export function recipientOf(chat: { owner_id: string; reporter_id: string }, senderId: string): string | null {
  if (senderId === chat.owner_id) return chat.reporter_id;
  if (senderId === chat.reporter_id) return chat.owner_id;
  return null;
}

export async function getAccessToken(saJson: string): Promise<{ token: string; projectId: string }> {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const toSign = `${enc(header)}.${enc(claim)}`;
  const keyData = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign));
  const jwt = `${toSign}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`oauth token request failed: ${resp.status} ${JSON.stringify(j)}`);
  return { token: j.access_token, projectId: sa.project_id };
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** Send one FCM v1 push per recipient, log to notification_logs, clean up invalid tokens. Returns a summary. */
export async function dispatchPush(
  supabase: SupabaseClient,
  opts: { reportId: string; recipients: { user_id: string; token: string }[]; notification: { title: string; body: string }; data: Record<string, string> },
): Promise<{ sent: number; total: number; logged: boolean; cleaned: boolean }> {
  if (opts.recipients.length === 0) return { sent: 0, total: 0, logged: true, cleaned: true };
  const { token: accessToken, projectId } = await getAccessToken(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
  const results: SendResult[] = [];
  for (const r of opts.recipients) {
    try {
      const fr = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: r.token, notification: opts.notification, data: opts.data } }),
      });
      if (fr.ok) results.push({ user_id: r.user_id, token: r.token, ok: true });
      else {
        const err = await fr.json().catch(() => ({}));
        // only a genuine FcmError detail drives token cleanup (not request-level errors)
        results.push({ user_id: r.user_id, token: r.token, ok: false, errorCode: extractFcmErrorCode(err) });
      }
    } catch (_e) {
      results.push({ user_id: r.user_id, token: r.token, ok: false });
    }
  }
  let logged = true; let cleaned = true;
  const logs = buildLogRows(opts.reportId, results);
  if (logs.length) { const { error: e } = await supabase.from('notification_logs').insert(logs); if (e) { logged = false; console.error('log insert failed', e); } }
  const bad = invalidTokensFrom(results);
  if (bad.length) { const { error: e } = await supabase.from('fcm_tokens').delete().in('token', bad); if (e) { cleaned = false; console.error('token cleanup failed', e); } }
  return { sent: results.filter((r) => r.ok).length, total: results.length, logged, cleaned };
}
