import { useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { signInWithProvider } from '../../src/services/auth';

export default function Login() {
  const [busy, setBusy] = useState(false);

  async function oauth(provider: 'kakao' | 'google') {
    try { setBusy(true); await signInWithProvider(provider); }
    catch (e: any) { Alert.alert('로그인 실패', e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.title}>멍백홈 🐶</Text>
      <Pressable style={[styles.btn, { backgroundColor: '#FEE500' }]} disabled={busy} onPress={() => oauth('kakao')}>
        <Text style={styles.btnDark}>카카오로 시작</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.outline]} disabled={busy} onPress={() => oauth('google')}>
        <Text style={styles.btnDark}>구글로 시작</Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: '#334155' }]} disabled={busy} onPress={() => router.push('/(auth)/email')}>
        <Text style={styles.btnLight}>이메일로 시작</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 24 },
  btn: { padding: 14, borderRadius: 12, alignItems: 'center' },
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  btnDark: { fontWeight: '700', color: '#111' },
  btnLight: { fontWeight: '700', color: '#fff' },
});
