import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { listMyDogs } from '../../../src/services/dogs';
import { createReport, countUsersNear } from '../../../src/services/missingReports';
import { validateReportForm, MIN_RADIUS_M, MAX_RADIUS_M } from '../../../src/validation/report';
import { Dog } from '../../../src/types/db';

export default function NewReport() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [dogId, setDogId] = useState<string>('');
  const [coord, setCoord] = useState({ lat: 37.6542, lng: 127.0568 });
  const [radius, setRadius] = useState(2000);
  const [reach, setReach] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { listMyDogs().then((d) => { setDogs(d); if (d[0]) setDogId(d[0].id); }).catch(() => {}); }, []);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (p.granted) { const pos = await Location.getCurrentPositionAsync({}); setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }
    });
  }, []);
  useEffect(() => { countUsersNear(coord.lat, coord.lng, radius).then(setReach).catch(() => setReach(null)); }, [coord, radius]);

  async function submit() {
    const lastSeenAt = new Date().toISOString();
    const v = validateReportForm({ dogId, radiusM: radius, lastSeenAt, lat: coord.lat, lng: coord.lng });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const id = await createReport({ dogId, lat: coord.lat, lng: coord.lng, radiusM: radius, lastSeenAt, note: note || undefined });
      if (reach === 0) Alert.alert('신고 완료', '주변에 알림 받을 사용자가 아직 없어요. 링크 공유로도 알릴 수 있어요(추후 기능).');
      router.replace(`/(app)/report/${id}/track`);
    } catch (e: any) { Alert.alert('신고 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: coord.lat, longitude: coord.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
          onPress={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}>
          <Marker draggable coordinate={{ latitude: coord.lat, longitude: coord.lng }}
            onDragEnd={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} />
          <Circle center={{ latitude: coord.lat, longitude: coord.lng }} radius={radius} strokeColor="#ef4444" fillColor="rgba(239,68,68,0.12)" />
        </MapView>
      </View>
      <Text style={styles.label}>반려견</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {dogs.map((d) => (
          <Pressable key={d.id} style={[styles.dog, dogId === d.id && styles.dogOn]} onPress={() => setDogId(d.id)}><Text>🐶 {d.name}</Text></Pressable>
        ))}
      </ScrollView>
      <Text style={styles.label}>알림 반경: {(radius / 1000).toFixed(1)}km · {reach == null ? '...' : `약 ${reach}명에게 알림`}</Text>
      <View style={styles.radiusRow}>
        {[500, 1000, 2000, 5000].map((r) => (
          <Pressable key={r} style={[styles.rb, radius === r && styles.rbOn]} onPress={() => setRadius(r)}><Text style={radius === r ? styles.rbOnText : undefined}>{r / 1000}km</Text></Pressable>
        ))}
      </View>
      <Text style={styles.label}>메모</Text>
      <TextInput style={styles.in} multiline value={note} onChangeText={setNote} placeholder="상황·특징 (선택)" />
      <Pressable style={styles.submit} disabled={busy} onPress={submit}><Text style={styles.submitText}>{busy ? '신고 중...' : '실종 신고하기'}</Text></Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 16, gap: 8 }, map: { height: 240, borderRadius: 14, overflow: 'hidden' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  dog: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  dogOn: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  radiusRow: { flexDirection: 'row', gap: 6 },
  rb: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 8, alignItems: 'center' },
  rbOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' }, rbOnText: { color: '#fff', fontWeight: '700' },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, minHeight: 60 },
  submit: { backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
