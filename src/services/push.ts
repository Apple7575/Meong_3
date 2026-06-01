import { supabase } from '../lib/supabase';

export type PushPlatform = 'ios' | 'android';

export async function registerPushToken(token: string, platform: PushPlatform): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert(
      { user_id: uid, token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
  if (error) throw new Error(error.message);
}
