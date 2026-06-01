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

export type ReportStatus = 'active' | 'resolved' | 'expired';
export type MissingReport = {
  id: string; owner_id: string; dog_id: string; status: ReportStatus;
  last_seen_at: string; alert_radius_m: number; note: string | null;
  expires_at: string; created_at: string; updated_at: string; resolved_at: string | null;
};
export type MissingReportWithDog = MissingReport & { dog: { name: string; breed: string | null; features: string | null } | null };
// getReport() returns this — last-seen coords resolved by the report_detail RPC (list leaves them off).
export type ReportDetail = MissingReportWithDog & { last_seen_lat: number; last_seen_lng: number };
export type Sighting = {
  id: string; report_id: string; reporter_id: string;
  seen_at: string; note: string | null; created_at: string;
  lat: number; lng: number; // resolved client-side from geometry via RPC/select
};
