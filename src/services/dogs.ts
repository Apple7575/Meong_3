import { supabase } from '../lib/supabase';
import { Dog } from '../types/db';
import { DogFormInput } from '../validation/dogs';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('로그인이 필요합니다.');
  return data.user.id;
}

export async function createDog(input: DogFormInput): Promise<Dog> {
  const owner_id = await uid();
  const { data, error } = await supabase
    .from('dogs')
    .insert({
      owner_id,
      name: input.name.trim(),
      breed: input.breed ?? null,
      gender: input.gender ?? null,
      is_neutered: input.is_neutered ?? null,
      features: input.features ?? null,
      emergency_contact: input.emergency_contact ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Dog;
}

export async function listMyDogs(): Promise<Dog[]> {
  const owner_id = await uid();
  const { data, error } = await supabase
    .from('dogs').select('*').eq('owner_id', owner_id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Dog[];
}
