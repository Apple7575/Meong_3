export type Profile = {
  id: string; nickname: string | null; phone: string | null;
  avatar_url: string | null; created_at: string; updated_at: string;
};
export type Gender = 'male' | 'female' | 'unknown';
export type Dog = {
  id: string; owner_id: string; name: string; breed: string | null;
  gender: Gender | null; is_neutered: boolean | null; features: string | null;
  emergency_contact: string | null; created_at: string; updated_at: string;
};
export type DogImage = {
  id: string; dog_id: string; storage_path: string;
  is_primary: boolean; sort_order: number; created_at: string;
};
