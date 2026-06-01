import { adminClient, dispatchPush } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const reportId: string = payload.record?.id ?? payload.report_id;
    if (!reportId) return new Response('no report id', { status: 400 });
    const supabase = adminClient();
    const { data: report } = await supabase.from('missing_reports').select('id, dog:dogs(name)').eq('id', reportId).single();
    const dogName = (report as any)?.dog?.name ?? '실종견';
    const { data: recipients, error } = await supabase.rpc('tokens_near_report', { p_report_id: reportId });
    if (error) return new Response(error.message, { status: 500 });
    const summary = await dispatchPush(supabase, {
      reportId,
      recipients: (recipients ?? []) as { user_id: string; token: string }[],
      notification: { title: '우리 동네 실종견', body: `${dogName}를 찾고 있어요. 혹시 보셨나요?` },
      data: { type: 'missing_report', report_id: reportId },
    });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
