import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GeoPoint } from './geo';
import { walkSession } from './activeWalk';

export const WALK_TASK = 'meong-walk-location';

// 전역(모듈 로드 시) 등록. app/_layout.tsx가 이 모듈을 import 하여 앱 엔트리에서 실행되게 한다.
TaskManager.defineTask(WALK_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const pts: GeoPoint[] = locations.map((l) => ({
    lat: l.coords.latitude, lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? undefined, t: l.timestamp,
  }));
  walkSession.ingest(pts); // 싱글톤이 필터+AsyncStorage 영속 (화면 유무와 무관)
});

export type WalkPermission = { foreground: boolean; background: boolean };
export async function requestWalkPermissions(): Promise<WalkPermission> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.status === 'granted' };
}

export async function startWalkUpdates(): Promise<void> {
  await Location.startLocationUpdatesAsync(WALK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000, distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: '산책 기록 중', notificationBody: '멍백홈이 산책 경로를 기록하고 있어요.' },
  });
}
export async function stopWalkUpdates(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(WALK_TASK)) await Location.stopLocationUpdatesAsync(WALK_TASK);
}
