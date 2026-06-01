import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { createDog } from '../../../src/services/dogs';
import { uploadDogImages } from '../../../src/services/images';
import { validateDogForm } from '../../../src/validation/dogs';
import { Gender } from '../../../src/types/db';

const GENDERS: { k: Gender; label: string }[] = [
  { k: 'male', label: '수컷' }, { k: 'female', label: '암컷' }, { k: 'unknown', label: '모름' },
];

export default function NewDog() {
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [gender, setGender] = useState<Gender>('unknown');
  const [neutered, setNeutered] = useState<boolean | null>(null);
  const [features, setFeatures] = useState('');
  const [contact, setContact] = useState('');
  const [uris, setUris] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.6,
    });
    if (!res.canceled) setUris(res.assets.map((a) => a.uri));
  }

  async function submit() {
    const v = validateDogForm({ name, gender });
    if (!v.valid) return Alert.alert('확인', v.errors.join('\n'));
    try {
      setBusy(true);
      const dog = await createDog({
        name, breed: breed || undefined, gender,
        is_neutered: neutered, features: features || undefined,
        emergency_contact: contact || undefined,
      });
      if (uris.length) {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid) throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
        await uploadDogImages(uid, dog.id, uris);
      }
      router.back();
    } catch (e: any) { Alert.alert('등록 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Pressable style={styles.photo} onPress={pick}>
        {uris[0]
          ? <Image source={{ uri: uris[0] }} style={styles.photoImg} />
          : <Text style={styles.photoText}>＋ 사진 추가 {uris.length > 1 ? `(${uris.length}장)` : ''}</Text>}
      </Pressable>

      <Text style={styles.label}>이름 *</Text>
      <TextInput style={styles.in} value={name} onChangeText={setName} placeholder="초코" />

      <Text style={styles.label}>견종</Text>
      <TextInput style={styles.in} value={breed} onChangeText={setBreed} placeholder="예: 말티즈" />

      <Text style={styles.label}>성별</Text>
      <View style={styles.seg}>
        {GENDERS.map((g) => (
          <Pressable key={g.k} style={[styles.segItem, gender === g.k && styles.segOn]} onPress={() => setGender(g.k)}>
            <Text style={gender === g.k ? styles.segOnText : styles.segText}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>중성화</Text>
      <View style={styles.seg}>
        {[{ v: true, l: '예' }, { v: false, l: '아니오' }, { v: null, l: '모름' }].map((o) => (
          <Pressable key={o.l} style={[styles.segItem, neutered === o.v && styles.segOn]} onPress={() => setNeutered(o.v)}>
            <Text style={neutered === o.v ? styles.segOnText : styles.segText}>{o.l}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>특징</Text>
      <TextInput style={[styles.in, { height: 72 }]} multiline value={features} onChangeText={setFeatures} placeholder="색·크기·습관 등" />

      <Text style={styles.label}>비상연락처</Text>
      <TextInput style={styles.in} value={contact} onChangeText={setContact} keyboardType="phone-pad" placeholder="비우면 프로필 번호 사용" />

      <Pressable style={styles.btn} disabled={busy} onPress={submit}>
        <Text style={styles.btnText}>{busy ? '등록 중...' : '등록하기'}</Text>
      </Pressable>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { padding: 24, gap: 6 },
  photo: { height: 120, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  photoImg: { width: '100%', height: '100%', borderRadius: 12 },
  photoText: { color: '#64748b' },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  seg: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  segOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  segText: { color: '#334155' },
  segOnText: { color: '#fff', fontWeight: '700' },
  btn: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
