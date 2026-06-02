import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { signInWithEmail, signUpWithEmail } from '../../src/services/auth';

export default function EmailAuth() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);

  async function submit() {
    try {
      setBusy(true);
      if (mode === 'in') await signInWithEmail(email.trim(), pw);
      else await signUpWithEmail(email.trim(), pw);
      // hand off to the entry gate (app/index.tsx) → routes to onboarding or home based on session
      router.replace('/');
    } catch (e: any) { Alert.alert('오류', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <TextInput style={styles.in} placeholder="이메일" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.in} placeholder="비밀번호 (6자 이상)" secureTextEntry value={pw} onChangeText={setPw} />
      <Pressable style={styles.btn} disabled={busy} onPress={submit}>
        <Text style={styles.btnText}>{mode === 'in' ? '로그인' : '가입'}</Text>
      </Pressable>
      <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')}>
        <Text style={styles.toggle}>{mode === 'in' ? '계정이 없나요? 가입하기' : '이미 계정이 있나요? 로그인'}</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  in: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, fontSize: 16 },
  btn: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  toggle: { textAlign: 'center', color: '#7c3aed', marginTop: 8 },
});
