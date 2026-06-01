export type LatLng = { lat: number; lng: number };
export type GeoPoint = LatLng & { accuracy?: number; t: number };

const EARTH_R = 6371000;
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export type AcceptOpts = { maxAccuracy?: number; minMoveMeters?: number; maxSpeedMps?: number };
export function acceptPoint(last: GeoPoint | null, p: GeoPoint, opts: AcceptOpts = {}): boolean {
  const maxAccuracy = opts.maxAccuracy ?? 30;
  const minMove = opts.minMoveMeters ?? 5;
  const maxSpeed = opts.maxSpeedMps ?? 8; // ~28.8km/h; walks never exceed, GPS spikes do
  if (p.accuracy != null && p.accuracy > maxAccuracy) return false;
  if (!last) return true;
  const dist = haversineMeters(last, p);
  if (dist < minMove) return false;
  const dtSec = (p.t - last.t) / 1000;
  if (dtSec <= 0) return false; // moved with non-increasing timestamp = implausible (GPS spike/dupe)
  if (dist / dtSec > maxSpeed) return false;
  return true;
}

export function filterNoise(points: GeoPoint[], opts: AcceptOpts = {}): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const p of points) if (acceptPoint(out[out.length - 1] ?? null, p, opts)) out.push(p);
  return out;
}

export function accumulateDistance(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineMeters(points[i - 1], points[i]);
  return d;
}

export function toGeoJSONLineString(points: LatLng[]): { type: 'LineString'; coordinates: number[][] } {
  return { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) };
}
