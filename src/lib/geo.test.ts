import { haversineMeters, acceptPoint, filterNoise, accumulateDistance, toGeoJSONLineString, GeoPoint } from './geo';

describe('geo', () => {
  test('haversine ~111km per 1° lat', () => {
    const d = haversineMeters({ lat: 37, lng: 127 }, { lat: 38, lng: 127 });
    expect(d).toBeGreaterThan(110000); expect(d).toBeLessThan(112000);
  });
  test('acceptPoint rejects bad accuracy', () => {
    expect(acceptPoint(null, { lat: 37, lng: 127, accuracy: 99, t: 0 })).toBe(false);
    expect(acceptPoint(null, { lat: 37, lng: 127, accuracy: 5, t: 0 })).toBe(true);
  });
  test('acceptPoint rejects sub-minMove jitter', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    expect(acceptPoint(last, { lat: 37.00001, lng: 127, accuracy: 5, t: 60000 })).toBe(false); // ~1.1m
  });
  test('acceptPoint rejects implausible speed jump', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    // ~111m in 1s = 111 m/s >> 8 m/s → reject (GPS spike after signal loss)
    expect(acceptPoint(last, { lat: 37.001, lng: 127, accuracy: 5, t: 1000 })).toBe(false);
  });
  test('acceptPoint accepts plausible walking move', () => {
    const last: GeoPoint = { lat: 37, lng: 127, accuracy: 5, t: 0 };
    // ~111m in 90s = 1.23 m/s → accept
    expect(acceptPoint(last, { lat: 37.001, lng: 127, accuracy: 5, t: 90000 })).toBe(true);
  });
  test('filterNoise applies acceptPoint across buffer', () => {
    const pts: GeoPoint[] = [
      { lat: 37, lng: 127, accuracy: 5, t: 0 },
      { lat: 37, lng: 127, accuracy: 99, t: 30000 },   // bad accuracy → drop
      { lat: 37.001, lng: 127, accuracy: 5, t: 90000 },// plausible → keep
    ];
    expect(filterNoise(pts).length).toBe(2);
  });
  test('accumulateDistance sums legs', () => {
    const d = accumulateDistance([{ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 }, { lat: 37.002, lng: 127 }]);
    expect(d).toBeGreaterThan(220); expect(d).toBeLessThan(225);
  });
  test('toGeoJSONLineString uses [lng,lat]', () => {
    expect(toGeoJSONLineString([{ lat: 37, lng: 127 }])).toEqual({ type: 'LineString', coordinates: [[127, 37]] });
  });
});
