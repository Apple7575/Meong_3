import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useBootstrapPermissions } from '../../src/lib/bootstrap';
import { listMyDogs } from '../../src/services/dogs';
import { signOut } from '../../src/services/auth';
import { Dog } from '../../src/types/db';

export default function Home() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  useBootstrapPermissions(true);

  async function refresh() {
    try { setDogs(await listMyDogs()); } catch (e: any) { Alert.alert('오류', e.message); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>내 반려견</Text>
      <FlatList
        data={dogs}
        keyExtractor={(d) => d.id}
        ListEmptyComponent={<Text style={styles.empty}>아직 등록된 반려견이 없어요.</Text>}
        renderItem={({ item }) => <Text style={styles.row}>🐶 {item.name}</Text>}
      />
      <Pressable style={styles.cta} onPress={() => router.push('/(app)/dogs/new')}>
        <Text style={styles.ctaText}>＋ 반려견 등록</Text>
      </Pressable>
      <Pressable onPress={() => signOut()}><Text style={styles.signout}>로그아웃</Text></Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, paddingTop: 60 },
  h: { fontSize: 24, fontWeight: '800', marginBottom: 16 },
  empty: { color: '#64748b', paddingVertical: 24, textAlign: 'center' },
  row: { fontSize: 18, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  cta: { backgroundColor: '#7c3aed', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signout: { textAlign: 'center', color: '#94a3b8', marginTop: 16 },
});
