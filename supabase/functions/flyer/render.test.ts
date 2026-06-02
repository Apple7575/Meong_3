import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { escapeHtml, staticMapUrl, renderFlyerHtml } from './render.ts';

Deno.test('escapeHtml escapes angle brackets/quotes', () => {
  assertEquals(escapeHtml(`<b>"초코"&</b>`), '&lt;b&gt;&quot;초코&quot;&amp;&lt;/b&gt;');
});
Deno.test('staticMapUrl centers + markers on the point with the key', () => {
  const u = staticMapUrl(37.65, 127.07, 'KEY123');
  assertStringIncludes(u, 'maps.googleapis.com/maps/api/staticmap');
  assertStringIncludes(u, 'center=37.65,127.07');
  assertStringIncludes(u, 'key=KEY123');
});
Deno.test('renderFlyerHtml escapes content, embeds static map + app deep link, leaks no sensitive fields', () => {
  const input = {
    dogName: '<b>초코</b>', breed: '말티즈', features: '흰색', lastSeenAt: '2026-06-02T00:00:00Z',
    lat: 37.65, lng: 127.07, photoUrl: 'https://x/p.jpg',
    // sensitive fields that must NEVER reach the public page even if mistakenly passed in
    phone: '01099998888', owner_id: 'OWNER-UUID-XYZ', emergency_contact: '01077776666', owner_phone: '01055554444',
  } as any;
  const html = renderFlyerHtml(input, { staticMapKey: 'KEY', appDeepLink: 'meongbackhome://report/r1' });
  assertStringIncludes(html, '&lt;b&gt;초코&lt;/b&gt;');           // escaped, not raw
  assertStringIncludes(html, 'maps.googleapis.com/maps/api/staticmap');
  assertStringIncludes(html, 'meongbackhome://report/r1');
  // renderFlyerHtml only reads SafeReport fields, so extra sensitive props can't leak
  for (const secret of ['01099998888', 'OWNER-UUID-XYZ', '01077776666', '01055554444']) {
    assertEquals(html.includes(secret), false);
  }
});
