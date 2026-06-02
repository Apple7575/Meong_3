import { useEffect, useState } from 'react';
import { View, Text, Pressable, Image, Alert, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { getReport } from '../../../../src/services/missingReports';
import { getOrCreateChat } from '../../../../src/services/chats';
import { ReportDetail as ReportDetailDto } from '../../../../src/types/db'; // aliased: component below is also named ReportDetail
import { supabase } from '../../../../src/lib/supabase';
import { FlyerShare } from '../../../../src/components/FlyerShare';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetailDto | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [canChat, setCanChat] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    getReport(id).then(async (r) => {
      setReport(r);
      const img = await supabase.from('dog_images').select('storage_path').eq('dog_id', r.dog_id).eq('is_primary', true).limit(1).maybeSingle();
      if (img.data?.storage_path) {
        const { data } = await supabase.storage.from('dog-images').createSignedUrl(img.data.storage_path, 3600);
        setPhoto(data?.signedUrl ?? null);
      }
    }).catch((e) => Alert.alert('오류', e.message));
  }, [id]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const me = data.user?.id; if (!me) return;
      const s = await supabase.from('sightings').select('id').eq('report_id', id).eq('reporter_id', me).limit(1);
      setCanChat((s.data?.length ?? 0) > 0);
    });
  }, [id]);

  // only resolve ownership once the report is loaded — avoids the report=null first-run racing the loaded run
  useEffect(() => {
    if (!report) return;
    supabase.auth.getUser().then(({ data }) => setIsOwner(data.user?.id === report.owner_id));
  }, [report]);

  if (!report) return <View style={styles.c}><Text>불러오는 중...</Text></View>;
  const d = report.dog;
  return (
    <View style={styles.c}>
      {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : <View style={[styles.photo, styles.ph]}><Text style={{ fontSize: 40 }}>🐕</Text></View>}
      <Text style={styles.name}>{d?.name ?? '실종견'} <Text style={styles.badge}>실종</Text></Text>
      <Text style={styles.meta}>{[d?.breed, d?.features].filter(Boolean).join(' · ')}</Text>
      <View style={styles.box}><Text style={styles.boxText}>📍 마지막 목격: {new Date(report.last_seen_at).toLocaleString('ko-KR')}</Text>
        {report.note ? <Text style={styles.boxText}>{report.note}</Text> : null}</View>
      <View style={styles.miniMap}>
        <MapView style={{ flex: 1 }} region={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
          <Marker coordinate={{ latitude: report.last_seen_lat, longitude: report.last_seen_lng }} title="마지막 목격" pinColor="#ef4444" />
        </MapView>
      </View>
      {isOwner && report && <FlyerShare reportId={id} dogName={report.dog?.name ?? '실종견'} />}
      {canChat && (
        <Pressable style={[styles.cta, { backgroundColor: '#16a34a', marginBottom: 8 }]} onPress={async () => {
          try { const { data } = await supabase.auth.getUser(); const cid = await getOrCreateChat(id, data.user!.id); router.push(`/(app)/chat/${cid}`); }
          catch (e: any) { Alert.alert('오류', e.message); }
        }}>
          <Text style={styles.ctaText}>💬 보호자와 대화</Text>
        </Pressable>
      )}
      <Pressable style={styles.cta} onPress={() => router.push(`/(app)/report/${id}/sighting`)}>
        <Text style={styles.ctaText}>👀 목격했어요 제보하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 20 },
  photo: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#e2e8f0' },
  ph: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800', marginTop: 14 },
  badge: { fontSize: 13, color: '#ef4444', backgroundColor: '#fee2e2', borderRadius: 6, paddingHorizontal: 6, overflow: 'hidden' },
  meta: { color: '#64748b', marginTop: 4 },
  box: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, marginTop: 14, gap: 4 },
  boxText: { color: '#475569', fontSize: 13 },
  miniMap: { height: 140, borderRadius: 12, overflow: 'hidden', marginTop: 12 },
  cta: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 'auto' },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
