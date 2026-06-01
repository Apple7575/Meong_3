import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, Alert, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../../src/lib/supabase';
import { createSighting, uploadSightingImages } from '../../../../src/services/sightings';
import { validateSightingForm } from '../../../../src/validation/report';

export default function SightingForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [coord, setCoord] = useState({ lat: 37.6542, lng: 127.0568 });
  const [uris, setUris] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (p.granted) { const pos = await Location.getCurrentPositionAsync({}); setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }
    });
  }, []);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.6 });
    if (!res.canceled) setUris(res.assets.map((a) => a.uri));
  }
  async function submit() {
    const seenAt = new Date().toISOString();
    const v = validateSightingForm({ seenAt, lat: coord.lat, lng: coord.lng });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const sid = await createSighting({ reportId: id, lat: coord.lat, lng: coord.lng, seenAt, note: note || undefined });
      if (uris.length) { const { data } = await supabase.auth.getUser(); const u = data.user?.id; if (!u) throw new Error('세션 만료'); await uploadSightingImages(u, sid, uris); }
      Alert.alert('제보 완료', '소중한 제보 감사합니다!');
      router.back();
    } catch (e: any) { Alert.alert('제보 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Pressable style={styles.photo} onPress={pick}>
        {uris[0] ? <Image source={{ uri: uris[0] }} style={{ width: '100%', height: '100%', borderRadius: 12 }} /> : <Text style={{ color: '#64748b' }}>＋ 사진 추가 {uris.length > 1 ? `(${uris.length})` : ''}</Text>}
      </Pressable>
      <Text style={styles.label}>목격 위치 (지도 탭/드래그)</Text>
      <View style={styles.map}>
        <MapView style={{ flex: 1 }} region={{ latitude: coord.lat, longitude: coord.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
          onPress={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}>
          <Marker draggable coordinate={{ latitude: coord.lat, longitude: coord.lng }} onDragEnd={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} />
        </MapView>
      </View>
      <Text style={styles.label}>메모</Text>
      <TextInput style={styles.in} multiline value={note} onChangeText={setNote} placeholder="어디서·어떤 상태로 봤는지 (선택)" />
      <Pressable style={styles.submit} disabled={busy} onPress={submit}><Text style={styles.submitText}>{busy ? '제보 중...' : '제보 보내기'}</Text></Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 16, gap: 8 },
  photo: { height: 110, borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  map: { height: 200, borderRadius: 12, overflow: 'hidden' },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, minHeight: 60 },
  submit: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
