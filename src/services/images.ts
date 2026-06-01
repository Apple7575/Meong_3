import { supabase } from '../lib/supabase';

export function buildImagePath(userId: string, dogId: string, fileId: string): string {
  return `${userId}/${dogId}/${fileId}.jpg`;
}

/**
 * 로컬 사진 URI 배열을 Storage에 업로드하고 dog_images 행을 만든다.
 * 부분 실패 시 업로드된 객체를 정리(고아 방지)한다.
 */
export async function uploadDogImages(
  userId: string,
  dogId: string,
  localUris: string[],
): Promise<void> {
  const uploaded: string[] = [];
  try {
    for (let i = 0; i < localUris.length; i++) {
      const fileId = `${Date.now()}-${i}`;
      const path = buildImagePath(userId, dogId, fileId);
      const res = await fetch(localUris[i]);
      const blob = await res.arrayBuffer();
      const up = await supabase.storage.from('dog-images').upload(path, blob, {
        contentType: 'image/jpeg', upsert: false,
      });
      if (up.error) throw new Error(up.error.message);
      uploaded.push(path);
      const row = await supabase.from('dog_images').insert({
        dog_id: dogId, storage_path: path, is_primary: i === 0, sort_order: i,
      });
      if (row.error) throw new Error(row.error.message);
    }
  } catch (e) {
    if (uploaded.length) await supabase.storage.from('dog-images').remove(uploaded);
    throw e;
  }
}
