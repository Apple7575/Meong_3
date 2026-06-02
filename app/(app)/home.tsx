import { useEffect, useState } from 'react';
import { useCallback } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useBootstrapPermissions } from '../../src/lib/bootstrap';
import { listMyDogs } from '../../src/services/dogs';
import { signOut } from '../../src/services/auth';
import { Dog } from '../../src/types/db';
import { walkSession } from '../../src/lib/activeWalk';

export default function Home() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  useBootstrapPermissions(true);

  async function refresh() {
    try { setDogs(await listMyDogs()); } catch (e: any) { Alert.alert('오류', e.message); }
  }
  useEffect(() => { refresh(); }, []);

  useFocusEffect(useCallback(() => {
    if (walkSession.getState() !== 'idle') return; // don't clobber an active in-memory walk
    walkSession.recover().then((r) => {
      if (!r.found) return;
      Alert.alert('진행 중이던 산책', '저장하지 못한 산책이 있어요. 이어서 진행할까요?', [
        { text: '나중에', style: 'cancel' },
        { text: '산책 화면으로', onPress: () => router.push('/(app)/walk') },
      ]);
    });
  }, []));

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
      <Pressable style={styles.walkCta} onPress={() => router.push('/(app)/walk')}>
        <Text style={styles.walkCtaText}>🐾 산책 시작</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/walk/history')}>
        <Text style={styles.walkHistText}>산책 기록 보기</Text>
      </Pressable>
      <Pressable style={styles.reportCta} onPress={() => router.push('/(app)/report/new')}>
        <Text style={styles.reportCtaText}>🚨 실종 신고</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/reports')}>
        <Text style={styles.walkHistText}>내 실종 신고</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/chats')}>
        <Text style={styles.walkHistText}>채팅</Text>
      </Pressable>
      <Pressable style={styles.walkHist} onPress={() => router.push('/(app)/map')}>
        <Text style={styles.walkHistText}>🗺️ 동네 실종 지도</Text>
      </Pressable>
      <Pressable onPress={async () => { try { await signOut(); } catch { /* 이미 화면을 떠나는 중 */ } }}><Text style={styles.signout}>로그아웃</Text></Pressable>
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
  walkCta: { backgroundColor: '#16a34a', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  walkCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  walkHist: { padding: 12, alignItems: 'center' }, walkHistText: { color: '#7c3aed', fontWeight: '700' },
  reportCta: { backgroundColor: '#ef4444', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 }, reportCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
