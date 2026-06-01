import { supabase } from '../lib/supabase';
import { MissingReport, MissingReportWithDog, ReportDetail } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
const wkt = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export async function createReport(input: { dogId: string; lat: number; lng: number; radiusM: number; lastSeenAt: string; note?: string }): Promise<string> {
  const owner_id = await uid();
  const { data, error } = await supabase.from('missing_reports').insert({
    owner_id, dog_id: input.dogId, last_seen_point: wkt(input.lat, input.lng),
    last_seen_at: input.lastSeenAt, alert_radius_m: input.radiusM, note: input.note ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function listMyReports(): Promise<MissingReportWithDog[]> {
  const owner_id = await uid();
  const { data, error } = await supabase.from('missing_reports')
    .select('*, dog:dogs(name,breed,features)').eq('owner_id', owner_id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MissingReportWithDog[];
}
export async function getReport(id: string): Promise<ReportDetail> {
  // report_detail RPC returns report fields + dog + last_seen_lat/lng (geography decomposed),
  // with RLS-equivalent visibility enforced inside the SECURITY DEFINER function.
  const { data, error } = await supabase.rpc('report_detail', { p_id: id }).single();
  if (error) throw new Error(error.message);
  return data as ReportDetail;
}
export async function resolveReport(id: string): Promise<void> {
  const { error } = await supabase.from('missing_reports')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function countUsersNear(lat: number, lng: number, radiusM: number): Promise<number> {
  const { data, error } = await supabase.rpc('count_users_near', { lat, lng, radius_m: radiusM });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
