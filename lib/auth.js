import { supabase } from './supabase';

// SIGN UP
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  return { data, error };
}

// SIGN IN
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  return { data, error };
}

// SIGN OUT
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// GET CURRENT USER
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}
