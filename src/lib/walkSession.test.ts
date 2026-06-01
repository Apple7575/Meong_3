import { WalkSession, PersistAdapter } from './walkSession';

function memoryStore(): PersistAdapter & { dump: () => string | null } {
  let v: string | null = null;
  return { save: async (s) => { v = s; }, load: async () => v, clear: async () => { v = null; }, dump: () => v };
}
const P = (lat: number, t: number) => ({ lat, lng: 127, accuracy: 5, t });

test('ingest filters jitter/spikes; distance from accepted points', async () => {
  const s = new WalkSession(memoryStore());
  await s.start('2026-06-02T00:00:00Z', 'dog1');
  s.ingest([P(37, 0), P(37.00001, 60000), P(37.001, 120000)]); // mid is jitter
  expect(s.getPoints().length).toBe(2);
  expect(s.getDistanceM()).toBeGreaterThan(110);
});
test('moving time excludes pause', async () => {
  const s = new WalkSession(memoryStore());
  const T0 = Date.parse('2026-06-02T00:00:00Z'); // same epoch domain as start/pause/resume
  await s.start('2026-06-02T00:00:00Z');
  s.pause(T0 + 60_000);   // 60s moving
  s.resume(T0 + 120_000); // paused 60s (not counted)
  // at T0+150s → moving = 60 + 30 = 90s
  expect(s.getMovingSeconds(T0 + 150_000)).toBe(90);
});
test('finish keeps buffer until commitSaved; summary uses moving time', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z', 'dog1');
  s.ingest([P(37, 0), P(37.001, 120000)]);
  const summary = s.finish('2026-06-02T00:02:00Z'); // 120s moving
  expect(summary.durationS).toBe(120);
  expect(summary.routeGeojson.type).toBe('LineString');
  expect(summary.dogId).toBe('dog1');
  expect(store.dump()).not.toBeNull();          // NOT cleared yet
  await s.commitSaved();
  expect(await store.load()).toBeNull();         // cleared only after commit
});
test('discard clears buffer', async () => {
  const store = memoryStore();
  const s = new WalkSession(store);
  await s.start('2026-06-02T00:00:00Z');
  s.ingest([P(37, 0)]);
  await s.discard();
  expect(await store.load()).toBeNull();
});
test('recover restores points as paused (recording crash)', async () => {
  const store = memoryStore();
  const a = new WalkSession(store);
  await a.start('2026-06-02T00:00:00Z', 'dog1');
  a.ingest([P(37, 0), P(37.001, 120000)]);
  const b = new WalkSession(store);
  const r = await b.recover();
  expect(r.found).toBe(true);
  expect(r.state).toBe('paused');
  expect(b.getPoints().length).toBe(2);
  expect(b.getPendingSummary()?.dogId).toBe('dog1');
});
test('recover restores finished state', async () => {
  const store = memoryStore();
  const a = new WalkSession(store);
  await a.start('2026-06-02T00:00:00Z');
  a.ingest([P(37, 0), P(37.001, 120000)]);
  a.finish('2026-06-02T00:02:00Z');
  const b = new WalkSession(store);
  const r = await b.recover();
  expect(r.state).toBe('finished');
  expect(b.getPendingSummary()?.durationS).toBe(120);
});
test('subscribe notified on ingest', async () => {
  const s = new WalkSession(memoryStore());
  let n = 0; s.subscribe(() => (n = s.getPoints().length));
  await s.start('2026-06-02T00:00:00Z');
  s.ingest([P(37, 0)]);
  expect(n).toBe(1);
});
