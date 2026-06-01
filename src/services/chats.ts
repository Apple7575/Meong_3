import { supabase } from '../lib/supabase';
import { ChatListItem, Message } from '../types/db';
import { cleanMessageBody, isValidMessage } from '../validation/message';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function getOrCreateChat(reportId: string, reporterId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_chat', { p_report_id: reportId, p_reporter_id: reporterId });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function myChats(): Promise<ChatListItem[]> {
  const { data, error } = await supabase.rpc('my_chats');
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatListItem[];
}
export async function listMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}
export async function sendMessage(chatId: string, raw: string): Promise<void> {
  if (!isValidMessage(raw)) throw new Error('메시지를 입력하세요.');
  const sender_id = await uid();
  const { error } = await supabase.from('messages').insert({ chat_id: chatId, sender_id, body: cleanMessageBody(raw) });
  if (error) throw new Error(error.message);
}
export function subscribeToChat(chatId: string, onInsert: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`chat:${chatId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload: { new: Message }) => onInsert(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
