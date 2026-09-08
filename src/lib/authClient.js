import { supabase } from './supabaseClient';

const requireSupabase = () => {
  if (!supabase) throw new Error('Supabase authentication is not configured.');
  return supabase;
};

const readProfile = async (client, user) => {
  let profile = user?.user_metadata?.profile || null;
  try {
    const { data, error } = await client
      .from('profiles')
      .select('profile')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    profile = data?.profile && typeof data.profile === 'object' ? data.profile : profile;
  } catch (error) {
    console.warn('Supabase profile table is unavailable; using Auth profile metadata.', error);
  }
  return profile;
};

export async function signUpWithProfile(email, password, profile) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { profile } },
  });
  if (error) throw error;

  if (data.user && data.session) {
    try {
      const { error: profileError } = await client
        .from('profiles')
        .upsert({ id: data.user.id, profile }, { onConflict: 'id' });
      if (profileError) throw profileError;
    } catch (profileError) {
      console.warn('Supabase profile table is unavailable; using Auth profile metadata.', profileError);
    }
  }

  return data;
}

export async function signInWithProfile(email, password) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { ...data, profile: await readProfile(client, data.user) };
}

export async function signOut() {
  if (!supabase) return;
  const client = supabase;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}