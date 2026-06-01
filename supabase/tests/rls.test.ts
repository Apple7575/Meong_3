import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    'Missing env vars. Ensure .env contains EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
  );
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function makeUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'password123', email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (signIn.error) throw signIn.error;
  return { id: data.user!.id, client };
}

describe('RLS isolation', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };

  beforeAll(async () => {
    const stamp = Date.now();
    alice = await makeUser(`alice-${stamp}@test.dev`);
    bob = await makeUser(`bob-${stamp}@test.dev`);
  });

  test('signup trigger created a profile for each user', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', alice.id).single();
    expect(data?.id).toBe(alice.id);
  });

  test('alice cannot read bob profile', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', bob.id);
    expect(data).toEqual([]);
  });

  test('alice cannot insert a dog owned by bob', async () => {
    const { error } = await alice.client.from('dogs').insert({ owner_id: bob.id, name: 'hack' });
    expect(error).not.toBeNull();
  });

  test('alice dog is invisible to bob', async () => {
    await alice.client.from('dogs').insert({ owner_id: alice.id, name: 'choco' });
    const { data } = await bob.client.from('dogs').select('*');
    expect(data?.some((d: any) => d.name === 'choco')).toBe(false);
  });
});
