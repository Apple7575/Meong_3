export type Profile = {
  id: string; nickname: string | null; phone: string | null;
  avatar_url: string | null; created_at: string; updated_at: string;
};
export type Gender = 'male' | 'female' | 'unknown';
export type Dog = {
  id: string; owner_id: string; name: string; breed: string | null;
  gender: Gender | null; is_neutered: boolean | null; features: string | null;
  emergency_contact: string | null; created_at: string; updated_at: string;
};
export type DogImage = {
  id: string; dog_id: string; storage_path: string;
  is_primary: boolean; sort_order: number; created_at: string;
};
export type WalkRecord = {
  id: string; user_id: string; dog_id: string | null;
  route_geojson: { type: 'LineString'; coordinates: number[][] };
  distance_m: number; duration_s: number;
  started_at: string; ended_at: string; use_for_missing_search: boolean; created_at: string;
};
export type WalkWithDog = WalkRecord & { dog: { name: string } | null };
export type WalkStats = { total_distance_m: number; total_count: number; this_week_count: number; current_streak: number };
