import { supabase } from '../lib/supabase';
import { Profile } from '../types/db';

export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function updateMyProfile(patch: { nickname: string; phone: string }): Promise<Profile> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { data, error } = await supabase
    .from('profiles')
    .update({ nickname: patch.nickname, phone: patch.phone, updated_at: new Date().toISOString() })
    .eq('id', uid)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}
