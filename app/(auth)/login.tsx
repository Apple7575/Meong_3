import { router } from 'expo-router';
import { View, Text, Pressable, StyleSheet } from 'react-native';

// OAuth (Kakao/Google) buttons are temporarily hidden — neither provider is configured in
// Supabase yet. Email auth is fully wired. Re-add the provider buttons (signInWithProvider
// in src/services/auth.ts is still present) once the Supabase Auth providers are set up.
export default function Login() {
  return (
    <View style={styles.c}>
      <Text style={styles.title}>멍백홈 🐶</Text>
      <Pressable style={[styles.btn, { backgroundColor: '#334155' }]} onPress={() => router.push('/(auth)/email')}>
        <Text style={styles.btnLight}>이메일로 시작</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 24 },
  btn: { padding: 14, borderRadius: 12, alignItems: 'center' },
  btnLight: { fontWeight: '700', color: '#fff' },
});
