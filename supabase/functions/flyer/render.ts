export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function staticMapUrl(lat: number, lng: number, key: string): string {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=600x300&markers=color:red%7C${lat},${lng}&key=${key}`;
}

// SafeReport intentionally has NO phone/owner fields — the render layer cannot leak them.
export type SafeReport = {
  dogName: string; breed: string | null; features: string | null;
  lastSeenAt: string; lat: number; lng: number; photoUrl: string | null;
};

export function renderFlyerHtml(r: SafeReport, opts: { staticMapKey: string; appDeepLink: string }): string {
  const name = escapeHtml(r.dogName);
  const meta = escapeHtml([r.breed, r.features].filter(Boolean).join(' · '));
  const when = escapeHtml(new Date(r.lastSeenAt).toLocaleString('ko-KR'));
  const photo = r.photoUrl ? `<img src="${escapeHtml(r.photoUrl)}" alt="${name}" style="width:100%;max-width:420px;border-radius:12px"/>` : '';
  const map = `<img src="${staticMapUrl(r.lat, r.lng, opts.staticMapKey)}" alt="마지막 목격 위치" style="width:100%;max-width:420px;border-radius:12px"/>`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${name} - 멍백홈 실종 신고</title>
<meta property="og:title" content="${name}를 찾고 있어요 - 멍백홈"/>
<meta property="og:description" content="${meta}"/>
${r.photoUrl ? `<meta property="og:image" content="${escapeHtml(r.photoUrl)}"/>` : ''}
</head><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1e293b">
<h1 style="font-size:24px">🐶 ${name} <span style="font-size:14px;color:#ef4444">실종</span></h1>
<p style="color:#64748b">${meta}</p>
${photo}
<h2 style="font-size:16px;margin-top:20px">📍 마지막 목격</h2>
<p style="color:#64748b">${when}</p>
${map}
<a href="${escapeHtml(opts.appDeepLink)}" style="display:block;background:#7c3aed;color:#fff;text-align:center;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;margin-top:20px">멍백홈 앱에서 목격 제보하기</a>
<p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:12px">멍백홈 · 우리 동네 유실견 구조</p>
</body></html>`;
}
