export const MIN_RADIUS_M = 300;
export const MAX_RADIUS_M = 10000;

// finite + earth-range guard — coords feed a WKT string sent to PostGIS, so reject NaN/Infinity/out-of-range.
export function isValidCoord(lat: number | null, lng: number | null): boolean {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function validateReportForm(input: { dogId: string; radiusM: number; lastSeenAt: string; lat: number | null; lng: number | null }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.dogId) errors.push('실종된 반려견을 선택하세요.');
  if (!isValidCoord(input.lat, input.lng)) errors.push('마지막 목격 위치를 지도에서 선택하세요.');
  if (input.radiusM < MIN_RADIUS_M || input.radiusM > MAX_RADIUS_M) errors.push(`알림 반경은 ${MIN_RADIUS_M}m~${MAX_RADIUS_M}m 사이여야 합니다.`);
  if (Date.parse(input.lastSeenAt) > Date.now()) errors.push('마지막 목격 시각이 미래일 수 없습니다.');
  return { valid: errors.length === 0, errors };
}
export function validateSightingForm(input: { seenAt: string; lat: number | null; lng: number | null }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isValidCoord(input.lat, input.lng)) errors.push('목격 위치를 지도에서 선택하세요.');
  if (Date.parse(input.seenAt) > Date.now()) errors.push('목격 시각이 미래일 수 없습니다.');
  return { valid: errors.length === 0, errors };
}
