import { supabase } from '../lib/supabase';
import { NeighborhoodReport, MapBounds } from '../types/db';

export async function reportsInBounds(b: MapBounds): Promise<NeighborhoodReport[]> {
  const { data, error } = await supabase.rpc('active_reports_in_bounds', {
    min_lng: b.minLng, min_lat: b.minLat, max_lng: b.maxLng, max_lat: b.maxLat,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NeighborhoodReport[];
}
