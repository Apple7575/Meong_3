import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { listMyReports, resolveReport } from '../../src/services/missingReports';
import { MissingReportWithDog } from '../../src/types/db';

export default function MyReports() {
  const [reports, setReports] = useState<MissingReportWithDog[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  async function refresh() { try { setReports(await listMyReports()); } catch (e: any) { Alert.alert('오류', e.message); } }
  useEffect(() => { refresh(); }, []);
  async function resolve(id: string) {
    if (resolving) return; // busy guard: no duplicate resolve taps
    try { setResolving(id); await resolveReport(id); await refresh(); }
    catch (e: any) { Alert.alert('오류', e.message); }
    finally { setResolving(null); }
  }
  return (
    <View style={styles.c}>
      <Text style={styles.h}>내 실종 신고</Text>
      <FlatList data={reports} keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 신고가 없어요.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/(app)/report/${item.id}/track`)}>
            <Text style={styles.rowMain}>{item.dog?.name ?? '실종견'} · {item.status === 'active' ? '🔴 진행 중' : '✅ 종료'}</Text>
            <Text style={styles.rowSub}>{new Date(item.created_at).toLocaleString('ko-KR')}</Text>
            {item.status === 'active' && (
              <Pressable disabled={resolving === item.id} onPress={() => resolve(item.id)}>
                <Text style={styles.resolve}>{resolving === item.id ? '처리 중...' : '찾았어요(종료)'}</Text>
              </Pressable>
            )}
          </Pressable>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  h: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 16, fontWeight: '700' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  resolve: { color: '#16a34a', fontWeight: '700', marginTop: 6 },
});
