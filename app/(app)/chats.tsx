import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { myChats } from '../../src/services/chats';
import { ChatListItem } from '../../src/types/db';

export default function Chats() {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  useEffect(() => { myChats().then(setChats).catch((e: any) => Alert.alert('오류', e.message)); }, []);
  return (
    <View style={styles.c}>
      <Text style={styles.h}>채팅</Text>
      <FlatList data={chats} keyExtractor={(c) => c.chat_id}
        ListEmptyComponent={<Text style={styles.empty}>아직 대화가 없어요.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/(app)/chat/${item.chat_id}`)}>
            <Text style={styles.title}>{item.other_nickname ?? '대화'} · 🐶 {item.dog_name ?? ''}{item.report_status !== 'active' ? ' (종료)' : ''}</Text>
            <Text style={styles.sub} numberOfLines={1}>{item.last_body ?? '새 대화'}</Text>
          </Pressable>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, paddingTop: 48 },
  h: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 16, fontWeight: '700' }, sub: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
});
