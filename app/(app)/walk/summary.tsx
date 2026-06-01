import { useState } from 'react';
import { View, Text, Pressable, Switch, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RouteMap } from '../../../src/components/RouteMap';
import { walkSession } from '../../../src/lib/activeWalk';
import { saveWalk } from '../../../src/services/walks';
import { LatLng } from '../../../src/lib/geo';

export default function WalkSummary() {
  const summary = walkSession.getPendingSummary();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!summary) {
    return <View style={styles.c}><Text style={styles.empty}>표시할 산책이 없어요.</Text>
      <Pressable style={styles.save} onPress={() => router.replace('/(app)/home')}><Text style={styles.saveText}>홈으로</Text></Pressable></View>;
  }
  const coords: LatLng[] = summary.routeGeojson.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
  const km = (summary.distanceM / 1000).toFixed(2);
  const min = Math.round(summary.durationS / 60);
  const speed = summary.durationS > 0 ? ((summary.distanceM / 1000) / (summary.durationS / 3600)).toFixed(1) : '0.0';

  async function save() {
    if (summary!.distanceM < 50 || summary!.durationS < 60) {
      const ok = await new Promise<boolean>((res) => Alert.alert('짧은 산책', '거리·시간이 매우 짧아요. 그래도 저장할까요?', [
        { text: '취소', style: 'cancel', onPress: () => res(false) }, { text: '저장', onPress: () => res(true) }]));
      if (!ok) return;
    }
    try {
      setBusy(true);
      await saveWalk({
        dogId: summary!.dogId, routeGeojson: summary!.routeGeojson,
        distanceM: summary!.distanceM, durationS: summary!.durationS,
        startedAt: summary!.startedAt, endedAt: summary!.endedAt, useForMissingSearch: consent,
      });
      await walkSession.commitSaved(); // DB 성공 후에만 버퍼 clear
      router.replace('/(app)/walk/history');
    } catch (e: any) {
      Alert.alert('저장 실패', `${e.message}\n경로는 보관돼 있어요. 다시 시도해주세요.`); // 버퍼 유지
    } finally { setBusy(false); }
  }
  function discard() {
    Alert.alert('산책 삭제', '저장하지 않고 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { await walkSession.discard(); router.replace('/(app)/home'); } }]);
  }

  return (
    <View style={styles.c}>
      <View style={styles.map}><RouteMap points={coords} /></View>
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.num}>{km}km</Text><Text style={styles.lbl}>거리</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{min}분</Text><Text style={styles.lbl}>시간</Text></View>
        <View style={styles.stat}><Text style={styles.num}>{speed}</Text><Text style={styles.lbl}>km/h</Text></View>
      </View>
      <View style={styles.consent}>
        <Switch value={consent} onValueChange={setConsent} />
        <Text style={styles.consentText}>이 경로를 실종 수색에 활용 허용 (선택)</Text>
      </View>
      <View style={styles.row}>
        <Pressable style={styles.discard} onPress={discard}><Text style={styles.discardText}>삭제</Text></Pressable>
        <Pressable style={styles.save} disabled={busy} onPress={save}><Text style={styles.saveText}>{busy ? '저장 중...' : '저장'}</Text></Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { flex: 1 }, empty: { textAlign: 'center', color: '#64748b', padding: 24 },
  stats: { flexDirection: 'row', padding: 16 }, stat: { flex: 1, alignItems: 'center' },
  num: { fontSize: 22, fontWeight: '800' }, lbl: { fontSize: 11, color: '#64748b' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  consentText: { fontSize: 13, color: '#475569', flex: 1 },
  row: { flexDirection: 'row', gap: 10, padding: 16 },
  discard: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, alignItems: 'center' }, discardText: { color: '#64748b', fontWeight: '700' },
  save: { flex: 2, backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center' }, saveText: { color: '#fff', fontWeight: '700' },
});
