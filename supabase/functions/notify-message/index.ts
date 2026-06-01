import { adminClient, dispatchPush, recipientOf } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = payload.record; // { id, chat_id, sender_id, body }
    if (!msg?.chat_id) return new Response('no message', { status: 400 });
    const supabase = adminClient();
    const { data: chat, error: chatErr } = await supabase.from('chats').select('owner_id, reporter_id, report_id').eq('id', msg.chat_id).single();
    if (chatErr || !chat) return new Response('no chat', { status: 404 });
    const recipientId = recipientOf(chat as any, msg.sender_id);
    if (!recipientId) return new Response('sender not a participant', { status: 400 });
    const { data: tokens, error: tokErr } = await supabase.from('fcm_tokens').select('user_id, token').eq('user_id', recipientId);
    if (tokErr) return new Response(tokErr.message, { status: 500 });
    const summary = await dispatchPush(supabase, {
      reportId: (chat as any).report_id,
      recipients: (tokens ?? []) as { user_id: string; token: string }[],
      notification: { title: '멍백홈', body: '새 메시지가 도착했어요' }, // body preview intentionally hidden (privacy)
      data: { type: 'chat_message', chat_id: msg.chat_id, report_id: (chat as any).report_id },
    });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
