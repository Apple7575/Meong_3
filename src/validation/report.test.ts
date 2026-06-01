import { validateReportForm, validateSightingForm } from './report';

describe('report validation', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();

  test('report requires dog, valid coords, valid radius, non-future last_seen', () => {
    expect(validateReportForm({ dogId: '', radiusM: 2000, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: null, lng: null }).valid).toBe(false); // no coords
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: 999, lng: 127 }).valid).toBe(false);   // out of range
    expect(validateReportForm({ dogId: 'd1', radiusM: 50, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);      // radius too small
    expect(validateReportForm({ dogId: 'd1', radiusM: 99999, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(false);   // too big
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: future, lat: 37, lng: 127 }).valid).toBe(false);  // future
    expect(validateReportForm({ dogId: 'd1', radiusM: 2000, lastSeenAt: past, lat: 37, lng: 127 }).valid).toBe(true);
  });
  test('sighting requires non-future seen_at and a point', () => {
    expect(validateSightingForm({ seenAt: future, lat: 37, lng: 127 }).valid).toBe(false);
    expect(validateSightingForm({ seenAt: past, lat: null, lng: null }).valid).toBe(false);
    expect(validateSightingForm({ seenAt: past, lat: 37, lng: 127 }).valid).toBe(true);
  });
});
