import { GeoPoint, LatLng, acceptPoint, accumulateDistance, toGeoJSONLineString } from './geo';

export type PersistAdapter = {
  save: (serialized: string) => Promise<void>;
  load: () => Promise<string | null>;
  clear: () => Promise<void>;
};
export type WalkSummary = {
  routeGeojson: { type: 'LineString'; coordinates: number[][] };
  distanceM: number; durationS: number; startedAt: string; endedAt: string; dogId: string | null;
};
export type State = 'idle' | 'recording' | 'paused' | 'finished';
type Snapshot = { startedAt: string; endedAt: string | null; dogId: string | null; points: GeoPoint[]; movingMs: number; state: State };

export class WalkSession {
  private state: State = 'idle';
  private startedAt: string | null = null;
  private endedAt: string | null = null;
  private dogId: string | null = null;
  private points: GeoPoint[] = [];
  private movingMs = 0;
  private segStart: number | null = null; // epoch ms when current recording segment began
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private store: PersistAdapter) {}

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((l) => l()); }

  async start(startedAt: string, dogId: string | null = null): Promise<void> {
    this.state = 'recording'; this.startedAt = startedAt; this.endedAt = null; this.dogId = dogId;
    this.points = []; this.movingMs = 0; this.segStart = Date.parse(startedAt);
    await this.persist(); this.emit();
  }

  ingest(pts: GeoPoint[]): void {
    if (this.state !== 'recording') return;
    let changed = false;
    for (const p of pts) {
      const last = this.points[this.points.length - 1] ?? null;
      if (acceptPoint(last, p)) { this.points.push(p); changed = true; }
    }
    if (changed) { void this.persist(); this.emit(); }
  }
  addPoint(p: GeoPoint): void { this.ingest([p]); }

  pause(nowMs: number = Date.now()): void {
    if (this.state !== 'recording') return;
    if (this.segStart != null) { this.movingMs += nowMs - this.segStart; this.segStart = null; }
    this.state = 'paused'; void this.persist(); this.emit();
  }
  resume(nowMs: number = Date.now()): void {
    if (this.state !== 'paused') return;
    this.segStart = nowMs; this.state = 'recording'; void this.persist(); this.emit();
  }

  getMovingSeconds(nowMs: number = Date.now()): number {
    let ms = this.movingMs;
    if (this.state === 'recording' && this.segStart != null) ms += nowMs - this.segStart;
    return Math.floor(ms / 1000);
  }
  flush(): Promise<void> { return this.chain; } // await all pending persists (UI may call before navigating)
  getDistanceM(): number { return accumulateDistance(this.points); }
  getPoints(): GeoPoint[] { return this.points; }
  getState(): State { return this.state; }
  getStartedAt(): string | null { return this.startedAt; }

  finish(endedAt: string): WalkSummary {
    // Add only the final recording segment to accumulated moving time (excludes pauses).
    const endMs = Date.parse(endedAt);
    if (this.state === 'recording' && this.segStart != null) {
      this.movingMs += endMs - this.segStart;
    }
    this.endedAt = endedAt; this.state = 'finished'; this.segStart = null;
    void this.persist();
    return this.getPendingSummary()!;
  }

  getPendingSummary(): WalkSummary | null {
    if (!this.startedAt) return null;
    const coords: LatLng[] = this.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    return {
      routeGeojson: toGeoJSONLineString(coords),
      distanceM: accumulateDistance(coords),
      durationS: Math.round(this.movingMs / 1000),
      startedAt: this.startedAt, endedAt: this.endedAt ?? this.startedAt, dogId: this.dogId,
    };
  }

  async commitSaved(): Promise<void> { await this.reset(); }
  async discard(): Promise<void> { await this.reset(); }
  private async reset(): Promise<void> {
    await this.chain; // drain any pending persist operations
    this.state = 'idle'; this.startedAt = null; this.endedAt = null; this.dogId = null;
    this.points = []; this.movingMs = 0; this.segStart = null;
    await this.store.clear(); this.emit();
  }

  async recover(): Promise<{ found: boolean; state: State }> {
    const raw = await this.store.load();
    if (!raw) return { found: false, state: 'idle' };
    const snap = JSON.parse(raw) as Snapshot;
    this.startedAt = snap.startedAt; this.endedAt = snap.endedAt; this.dogId = snap.dogId;
    this.points = snap.points; this.movingMs = snap.movingMs; this.segStart = null;
    // recording crash → resume paused so the offline gap is not counted as moving time
    this.state = snap.state === 'finished' ? 'finished' : 'paused';
    this.emit();
    return { found: true, state: this.state };
  }

  private persist(): Promise<void> {
    if (!this.startedAt) return Promise.resolve();
    const snap: Snapshot = {
      startedAt: this.startedAt, endedAt: this.endedAt, dogId: this.dogId,
      points: this.points, movingMs: this.movingMs, state: this.state,
    };
    const s = JSON.stringify(snap);
    // Serialize the save INSIDE the chain so an older slow write cannot land
    // after a newer one (stale-snapshot race on real async storage).
    this.chain = this.chain.then(() => this.store.save(s)).catch(() => {});
    return this.chain;
  }
}
