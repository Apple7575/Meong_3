import { useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { walkSession } from '../../../src/lib/activeWalk';
import { requestWalkPermissions, startWalkUpdates, stopWalkUpdates } from '../../../src/lib/walkLocation';
import { listMyDogs } from '../../../src/services/dogs';
import { Dog } from '../../../src/types/db';
import { LatLng } from '../../../src/lib/geo';

export default function WalkScreen() {
  const [state, setState] = useState(walkSession.getState());
  const [points, setPoints] = useState<LatLng[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [moving, setMoving] = useState(0);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [dogId, setDogId] = useState<string | null>(null);

  // finished 상태로 진입(복구 등) → 요약으로
  useEffect(() => { if (walkSession.getState() === 'finished') router.replace('/(app)/walk/summary'); }, []);

  useEffect(() => {
    const sync = () => {
      setState(walkSession.getState());
      setPoints(walkSession.getPoints().map((p) => ({ lat: p.lat, lng: p.lng })));
      setDistanceM(walkSession.getDistanceM());
    };
    const unsub = walkSession.subscribe(sync); sync();
    return unsub;
  }, []);

  useEffect(() => { listMyDogs().then(setDogs).catch(() => {}); }, []);

  useEffect(() => {
    const id = setInterval(() => setMoving(walkSession.getMovingSeconds()), 1000);
    return () => clearInterval(id);
  }, []);

  async function start() {
    const perm = await requestWalkPermissions();
    if (!perm.foreground) { Alert.alert('위치 권한 필요', '위치 권한을 허용해야 산책을 기록할 수 있어요.'); return; }
    if (!perm.background) Alert.alert('백그라운드 권한 제한', '화면을 켠 채로 기록됩니다. 정확한 기록을 위해 설정에서 "항상 허용"을 권장해요.');
    await walkSession.start(new Date().toISOString(), dogId);
    await startWalkUpdates();
  }
  async function finish() {
    await stopWalkUpdates();
    walkSession.finish(new Date().toISOString());
    router.push('/(app)/walk/summary');
  }

  const km = (distanceM / 1000).toFixed(2);
  const mmss = `${String(Math.floor(moving / 60)).padStart(2, '0')}:${String(moving % 60).padStart(2, '0')}`;
  const recording = state === 'recording' || state === 'paused';

  return (
    <View style={styles.c}>
      <View style={styles.map}><RouteMap points={points} /></View>
      {!recording && (
        <ScrollView horizontal style={styles.dogRow} contentContainerStyle={{ gap: 8, padding: 12 }}>
          <Pressable style={[styles.dog, dogId === null && styles.dogOn]} onPress={() => setDogId(null)}><Text>강아지 없이</Text></Pressable>
          {dogs.map((d) => (
            <Pressable key={d.id} style={[styles.dog, dogId === d.id && styles.dogOn]} onPress={() => setDogId(d.id)}><Text>🐶 {d.name}</Text></Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.num}>{km}<Text style={styles.unit}>km</Text></Text><Text style={styles.lbl}>거리</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{mmss}</Text><Text style={styles.lbl}>시간</Text></View>
      </View>
      {!recording ? (
        <Pressable style={styles.start} onPress={start}><Text style={styles.startText}>산책 시작</Text></Pressable>
      ) : (
        <View style={styles.row}>
          <Pressable style={styles.pause} onPress={() => (state === 'paused' ? walkSession.resume() : walkSession.pause())}>
            <Text style={styles.pauseText}>{state === 'paused' ? '▶ 재개' : '⏸ 일시정지'}</Text>
          </Pressable>
          <Pressable style={styles.stop} onPress={finish}><Text style={styles.stopText}>⏹ 종료</Text></Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { flex: 1 },
  dogRow: { maxHeight: 56, flexGrow: 0 },
  dog: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  dogOn: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  stats: { flexDirection: 'row', padding: 16 },
  stat: { flex: 1, alignItems: 'center' }, num: { fontSize: 28, fontWeight: '800' }, unit: { fontSize: 13 },
  lbl: { fontSize: 12, color: '#64748b' },
  start: { backgroundColor: '#7c3aed', margin: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  startText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  pause: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' }, pauseText: { fontWeight: '700' },
  stop: { flex: 1, backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center' }, stopText: { color: '#fff', fontWeight: '700' },
});
