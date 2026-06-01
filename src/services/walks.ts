import { supabase } from '../lib/supabase';
import { WalkWithDog, WalkStats } from '../types/db';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}
export type SaveWalkInput = {
  dogId: string | null; routeGeojson: unknown; distanceM: number; durationS: number;
  startedAt: string; endedAt: string; useForMissingSearch: boolean;
};
export async function saveWalk(input: SaveWalkInput): Promise<string> {
  const user_id = await uid();
  const { data, error } = await supabase.from('walk_records').insert({
    user_id, dog_id: input.dogId, route_geojson: input.routeGeojson,
    distance_m: input.distanceM, duration_s: input.durationS,
    started_at: input.startedAt, ended_at: input.endedAt, use_for_missing_search: input.useForMissingSearch,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function listMyWalks(): Promise<WalkWithDog[]> {
  const user_id = await uid();
  const { data, error } = await supabase.from('walk_records')
    .select('*, dog:dogs(name)').eq('user_id', user_id).order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WalkWithDog[];
}
export async function deleteWalk(id: string): Promise<void> {
  const { error } = await supabase.from('walk_records').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
export async function getWalkStats(): Promise<WalkStats> {
  const { data, error } = await supabase.rpc('my_walk_stats').single();
  if (error) throw new Error(error.message);
  return data as WalkStats;
}
