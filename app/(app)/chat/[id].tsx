import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { listMessages, sendMessage, subscribeToChat, myChats } from '../../../src/services/chats';
import { supabase } from '../../../src/lib/supabase';
import { Message } from '../../../src/types/db';

export default function ChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const [other, setOther] = useState<string>('대화');
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  useEffect(() => {
    myChats().then((rows) => { const c = rows.find((r) => r.chat_id === id); if (c) { setOther(c.other_nickname ?? '대화'); setClosed(c.report_status !== 'active'); } }).catch(() => {});
    // subscribe FIRST so a message arriving during the initial history fetch isn't dropped
    const add = (m: Message) => setMessages((prev) => {
      const byId = new Map(prev.map((x) => [x.id, x])); byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    const unsub = subscribeToChat(id, add);
    // then load history and MERGE (union by id) with anything realtime already delivered
    listMessages(id)
      .then((hist) => setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m])); for (const m of hist) byId.set(m.id, m);
        return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      }))
      .catch((e) => Alert.alert('오류', e.message));
    return unsub;
  }, [id]);

  async function send() {
    const body = text;
    try { setBusy(true); await sendMessage(id, body); setText(''); }
    catch (e: any) { Alert.alert('전송 실패', e.message); } // text kept on failure
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.header}>{other}</Text>
      <FlatList ref={listRef} data={messages} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender_id === me ? styles.mine : styles.theirs]}>
            <Text style={item.sender_id === me ? styles.mineText : undefined}>{item.body}</Text>
          </View>
        )} />
      {closed ? (
        <Text style={styles.closed}>종료된 신고예요 (읽기 전용)</Text>
      ) : (
        <View style={styles.inputRow}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="메시지" multiline />
          <Pressable style={styles.send} disabled={busy} onPress={send}><Text style={styles.sendText}>전송</Text></Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 },
  header: { fontSize: 17, fontWeight: '800', padding: 14, paddingTop: 48, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  bubble: { maxWidth: '78%', padding: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#7c3aed' }, mineText: { color: '#fff' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  closed: { textAlign: 'center', color: '#94a3b8', padding: 16, borderTopWidth: 1, borderColor: '#e2e8f0' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 100 },
  send: { backgroundColor: '#7c3aed', borderRadius: 18, paddingHorizontal: 16, justifyContent: 'center' }, sendText: { color: '#fff', fontWeight: '700' },
});
