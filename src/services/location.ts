import { supabase } from '../lib/supabase';

export async function upsertMyLocation(lat: number, lng: number): Promise<void> {
  const { error } = await supabase.rpc('upsert_my_location', { lat, lng });
  if (error) throw new Error(error.message);
}
