import { supabase } from '../lib/supabase';

export type FlagContentType = 'sighting' | 'message';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function hideSighting(sightingId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc('hide_sighting', { p_sighting_id: sightingId, p_hidden: hidden });
  if (error) throw new Error(error.message);
}

export async function blockUser(blockedId: string): Promise<void> {
  const blocker_id = await uid();
  const { error } = await supabase.from('blocks').insert({ blocker_id, blocked_id: blockedId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(blockedId: string): Promise<void> {
  const blocker_id = await uid();
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', blocker_id).eq('blocked_id', blockedId);
  if (error) throw new Error(error.message);
}

export async function flagContent(type: FlagContentType, contentId: string, reason: string): Promise<void> {
  const reporter_id = await uid();
  const { error } = await supabase.from('content_flags').insert({ content_type: type, content_id: contentId, reporter_id, reason });
  if (error) throw new Error(error.message);
}
