import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { updateMyProfile } from '../../src/services/profile';
import { isValidPhone, normalizePhone } from '../../src/validation/profile';

export default function Onboarding() {
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!nickname.trim()) return Alert.alert('확인', '닉네임을 입력해주세요.');
    if (!isValidPhone(phone)) return Alert.alert('확인', '올바른 휴대폰 번호를 입력해주세요.');
    try {
      setBusy(true);
      await updateMyProfile({ nickname: nickname.trim(), phone: normalizePhone(phone) });
      router.replace('/(app)/home');
    } catch (e: any) { Alert.alert('오류', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.h}>프로필 설정</Text>
      <Text style={styles.label}>닉네임 *</Text>
      <TextInput style={styles.in} value={nickname} onChangeText={setNickname} placeholder="예: 초코아빠" />
      <Text style={styles.label}>연락처 *</Text>
      <TextInput style={styles.in} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="010-1234-5678" />
      <Text style={styles.note}>연락처는 앱 내부에서만 사용되며 알림·공개 페이지에 노출되지 않습니다.</Text>
      <Pressable style={styles.btn} disabled={busy} onPress={save}>
        <Text style={styles.btnText}>시작하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  h: { fontSize: 24, fontWeight: '800', marginBottom: 12 },
  label: { fontWeight: '700', color: '#475569', marginTop: 8 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  note: { fontSize: 12, color: '#64748b', marginTop: 4 },
  btn: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '700' },
});
