import { adminClient } from '../_shared/fcm.ts';
import { renderFlyerHtml, SafeReport } from './render.ts';

function page(body: string, status = 200): Response {
  return new Response(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#475569">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  try {
    const reportId = new URL(req.url).searchParams.get('report');
    if (!reportId) return page('<h1>잘못된 링크입니다</h1>');
    const supabase = adminClient();
    // report_detail returns the report only when active (service role → auth.uid() is null → "owner OR active" = active),
    // and never includes phone — so active-only + privacy are enforced by the RPC.
    const { data: rep } = await supabase.rpc('report_detail', { p_id: reportId }).maybeSingle();
    if (!rep) return page('<h1>종료되었거나 찾을 수 없는 신고입니다</h1><p>이미 해결되었을 수 있어요. 멍백홈을 이용해 주셔서 감사합니다.</p>');
    const r = rep as any;
    // primary photo signed URL (service role bypasses RLS)
    let photoUrl: string | null = null;
    const { data: img } = await supabase.from('dog_images').select('storage_path').eq('dog_id', r.dog_id).eq('is_primary', true).limit(1).maybeSingle();
    if (img?.storage_path) {
      const { data: signed } = await supabase.storage.from('dog-images').createSignedUrl(img.storage_path, 3600);
      photoUrl = signed?.signedUrl ?? null;
    }
    const safe: SafeReport = {
      dogName: r.dog?.name ?? '실종견', breed: r.dog?.breed ?? null, features: r.dog?.features ?? null,
      lastSeenAt: r.last_seen_at, lat: r.last_seen_lat, lng: r.last_seen_lng, photoUrl,
    };
    const html = renderFlyerHtml(safe, {
      staticMapKey: Deno.env.get('GOOGLE_STATIC_MAPS_KEY') ?? '',
      appDeepLink: `meongbackhome://report/${reportId}`,
    });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (_e) {
    return page('<h1>일시적인 오류입니다</h1><p>잠시 후 다시 시도해 주세요.</p>', 500);
  }
});
