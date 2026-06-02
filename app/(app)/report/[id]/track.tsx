import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Alert, StyleSheet, Pressable } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { getReport } from '../../../../src/services/missingReports';
import { getOrCreateChat } from '../../../../src/services/chats';
import { listSightingsForReport } from '../../../../src/services/sightings';
import { hideSighting, flagContent } from '../../../../src/services/moderation';
import { supabase } from '../../../../src/lib/supabase';
import { ReportDetail, Sighting } from '../../../../src/types/db';

export default function TrackMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  const loadSightings = useCallback(() => {
    listSightingsForReport(id).then(setSightings).catch((e) => Alert.alert('오류', e.message));
  }, [id]);

  useEffect(() => {
    getReport(id).then(setReport).catch((e) => Alert.alert('오류', e.message));
    loadSightings();
  }, [id, loadSightings]);

  // resolve ownership once the report is loaded (owner-only moderation controls)
  useEffect(() => {
    if (!report) return;
    supabase.auth.getUser().then(({ data }) => setIsOwner(data.user?.id === report.owner_id));
  }, [report]);

  function onHide(sightingId: string) {
    Alert.alert('제보 숨기기', '이 제보를 지도와 목록에서 숨길까요?', [
      { text: '취소', style: 'cancel' },
      { text: '숨기기', style: 'destructive', onPress: async () => {
        try { await hideSighting(sightingId, true); loadSightings(); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }
  function onFlag(sightingId: string) {
    Alert.alert('제보 신고', '이 제보를 부적절한 콘텐츠로 신고할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '신고', style: 'destructive', onPress: async () => {
        try { await flagContent('sighting', sightingId, '부적절한 제보'); Alert.alert('접수됨', '신고가 접수되었어요.'); }
        catch (e: any) { Alert.alert('오류', e.message); }
      } },
    ]);
  }

  const center = sightings.length
    ? { lat: sightings[sightings.length - 1].lat, lng: sightings[sightings.length - 1].lng }
    : report ? { lat: report.last_seen_lat, lng: report.last_seen_lng } : { lat: 37.6542, lng: 127.0568 };
  return (
    <View style={styles.c}>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}>
          {report && <Marker coordinate={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng }} title="마지막 목격" pinColor="#ef4444" />}
          {sightings.map((s, i) => (
            <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lng }} title={`제보 ${i + 1}`} description={new Date(s.seen_at).toLocaleString('ko-KR')} pinColor="#7c3aed" />
          ))}
        </MapView>
      </View>
      <Text style={styles.h}>제보 {sightings.length}건</Text>
      <FlatList data={sightings} keyExtractor={(s) => s.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 제보가 없어요. 알림을 받은 이웃의 제보를 기다리는 중이에요.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.row}><Text style={styles.rowMain}>{index + 1}. {item.note || '목격 제보'}</Text>
            <Text style={styles.rowSub}>{new Date(item.seen_at).toLocaleString('ko-KR')}</Text>
            <View style={styles.actions}>
              <Pressable onPress={async () => {
                try { const cid = await getOrCreateChat(item.report_id, item.reporter_id); router.push(`/(app)/chat/${cid}`); }
                catch (e: any) { Alert.alert('오류', e.message); }
              }}>
                <Text style={styles.chatLink}>💬 제보자와 대화</Text>
              </Pressable>
              {isOwner && <Pressable onPress={() => onHide(item.id)}><Text style={styles.modLink}>숨김</Text></Pressable>}
              <Pressable onPress={() => onFlag(item.id)}><Text style={styles.flagLink}>신고</Text></Pressable>
            </View>
          </View>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 }, map: { height: 300 },
  h: { fontWeight: '800', fontSize: 16, padding: 16, paddingBottom: 6 },
  empty: { color: '#64748b', padding: 16 },
  row: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  rowMain: { fontSize: 15, fontWeight: '600' }, rowSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6, alignItems: 'center' },
  chatLink: { color: '#7c3aed', fontWeight: '700' },
  modLink: { color: '#64748b', fontWeight: '700' },
  flagLink: { color: '#ef4444', fontWeight: '700' },
});
