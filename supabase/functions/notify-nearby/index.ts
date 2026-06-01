import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildLogRows, invalidTokensFrom, buildFcmMessage, SendResult } from './logic.ts';

// FCM HTTP v1 access token from the service account (cached per cold start).
async function getAccessToken(saJson: string): Promise<{ token: string; projectId: string }> {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const reportId: string = payload.record?.id ?? payload.report_id;
    if (!reportId) return new Response('no report id', { status: 400 });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: report } = await supabase.from('missing_reports').select('id, dog:dogs(name)').eq('id', reportId).single();
    const dogName = (report as any)?.dog?.name ?? '실종견';

    const { data: recipients, error } = await supabase.rpc('tokens_near_report', { p_report_id: reportId });
    if (error) return new Response(error.message, { status: 500 });

    const { token: accessToken, projectId } = await getAccessToken(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
    const results: SendResult[] = [];
    for (const r of recipients as { user_id: string; token: string }[]) {
      try {
        const fr = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildFcmMessage(r.token, { id: reportId, dogName })),
        });
        if (fr.ok) results.push({ user_id: r.user_id, token: r.token, ok: true });
        else {
          const err = await fr.json().catch(() => ({}));
          // ONLY an FCM FcmError errorCode (from details) drives token cleanup — never the request-level
          // status, so a payload-level INVALID_ARGUMENT can't delete valid tokens.
          const fcmErrorCode = (err?.error?.details ?? []).find((d: any) => typeof d?.errorCode === 'string')?.errorCode;
          results.push({ user_id: r.user_id, token: r.token, ok: false, errorCode: fcmErrorCode });
        }
      } catch (_e) {
        // a thrown fetch (network) must not abort the whole batch or lose already-sent logs
        results.push({ user_id: r.user_id, token: r.token, ok: false });
      }
    }

    // Surface (not swallow) log/cleanup errors. Return 200 either way: pushes already went out, and a
    // non-2xx would make the webhook retry → duplicate sends.
    let logged = true;
    let cleaned = true;
    const logs = buildLogRows(reportId, results);
    if (logs.length) {
      const { error: e } = await supabase.from('notification_logs').insert(logs);
      if (e) { logged = false; console.error('notification_logs insert failed', e); }
    }
    const bad = invalidTokensFrom(results);
    if (bad.length) {
      const { error: e } = await supabase.from('fcm_tokens').delete().in('token', bad);
      if (e) { cleaned = false; console.error('fcm_tokens cleanup failed', e); }
    }

    return new Response(JSON.stringify({ sent: results.filter((r) => r.ok).length, total: results.length, logged, cleaned }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
