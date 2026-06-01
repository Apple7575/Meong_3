import { supabase } from '../lib/supabase';
import { Sighting } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
const wkt = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export function buildSightingImagePath(userId: string, sightingId: string, fileId: string): string {
  return `${userId}/${sightingId}/${fileId}.jpg`;
}

export async function createSighting(input: { reportId: string; lat: number; lng: number; seenAt: string; note?: string }): Promise<string> {
  const reporter_id = await uid();
  const { data, error } = await supabase.from('sightings').insert({
    report_id: input.reportId, reporter_id, point: wkt(input.lat, input.lng),
    seen_at: input.seenAt, note: input.note ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listSightingsForReport(reportId: string): Promise<Sighting[]> {
  const { data, error } = await supabase.from('sightings').select('*').eq('report_id', reportId).order('seen_at', { ascending: true });
  if (error) throw new Error(error.message);
  // geography column comes back as GeoJSON/EWKB depending on config; resolve lat/lng best-effort
  return (data ?? []).map((r: any) => ({ ...r, lat: r.lat ?? null, lng: r.lng ?? null })) as Sighting[];
}

export async function uploadSightingImages(userId: string, sightingId: string, localUris: string[]): Promise<void> {
  const uploaded: string[] = [];
  const rowIds: string[] = [];
  try {
    for (let i = 0; i < localUris.length; i++) {
      const path = buildSightingImagePath(userId, sightingId, `${Date.now()}-${i}`);
      const res = await fetch(localUris[i]);
      const buffer = await res.arrayBuffer();
      const up = await supabase.storage.from('sightings').upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(up.error.message);
      uploaded.push(path);
      const row = await supabase.from('sighting_images').insert({ sighting_id: sightingId, storage_path: path, sort_order: i }).select('id').single();
      if (row.error) throw new Error(row.error.message);
      if (row.data?.id) rowIds.push(row.data.id as string);
    }
  } catch (e) {
    if (rowIds.length) await supabase.from('sighting_images').delete().in('id', rowIds);
    if (uploaded.length) await supabase.storage.from('sightings').remove(uploaded);
    throw e;
  }
}
