import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { listMyWalks, getWalkStats } from '../../../src/services/walks';
import { WalkWithDog, WalkStats } from '../../../src/types/db';
import { RouteThumbnail } from '../../../src/components/RouteThumbnail';

export default function WalkHistory() {
  const [stats, setStats] = useState<WalkStats | null>(null);
  const [walks, setWalks] = useState<WalkWithDog[]>([]);
  useEffect(() => {
    (async () => {
      try { setStats(await getWalkStats()); setWalks(await listMyWalks()); }
      catch (e: any) { Alert.alert('오류', e.message); }
    })();
  }, []);
  return (
    <View style={styles.c}>
      <View style={styles.grid}>
        <Stat emoji="🔥" value={`${stats?.current_streak ?? 0}일`} label="연속 기록" hi />
        <Stat value={`${((stats?.total_distance_m ?? 0) / 1000).toFixed(1)}km`} label="누적 거리" />
        <Stat value={`${stats?.total_count ?? 0}회`} label="총 산책" />
        <Stat value={`${stats?.this_week_count ?? 0}회`} label="이번 주" />
      </View>
      <Text style={styles.section}>지난 산책</Text>
      <FlatList data={walks} keyExtractor={(w) => w.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 산책 기록이 없어요.</Text>}
        renderItem={({ item }) => (
          <View style={styles.rowItem}>
            <RouteThumbnail coordinates={item.route_geojson?.coordinates ?? []} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowMain}>{(item.distance_m / 1000).toFixed(2)}km · {Math.round(item.duration_s / 60)}분</Text>
              <Text style={styles.rowSub}>{new Date(item.started_at).toLocaleString('ko-KR')}{item.dog ? ` · ${item.dog.name}` : ''}</Text>
            </View>
          </View>
        )} />
    </View>
  );
}
function Stat({ emoji, value, label, hi }: { emoji?: string; value: string; label: string; hi?: boolean }) {
  return (
    <View style={[styles.stat, hi && styles.statHi]}>
      <Text style={styles.statVal}>{emoji ? `${emoji} ` : ''}{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
  statHi: { backgroundColor: '#f5f3ff' }, statVal: { fontSize: 20, fontWeight: '800' }, statLbl: { fontSize: 11, color: '#64748b', marginTop: 2 },
  section: { fontWeight: '800', fontSize: 16, marginTop: 20, marginBottom: 8 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 15, fontWeight: '700' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
});
