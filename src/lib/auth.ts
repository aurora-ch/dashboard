import { supabase, isSupabaseEnabled } from './supabase'

export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: { first_name?: string; last_name?: string; phone?: string }
) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    })
    if (error) throw error
    return { data, error: null }
  } catch (error) {
    console.error('Sign up error:', error)
    return { data: null, error }
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data.user) {
      await verifyOrCreateCustomerRecord(data.user)
    }
    return { data, error: null }
  } catch (error) {
    console.error('Sign in error:', error)
    return { data: null, error }
  }
}

export async function signInWithGoogle() {
  try {
    if (!isSupabaseEnabled) {
      return { data: null, error: { message: 'Supabase is not configured.' } }
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
    return { data, error: null }
  } catch (error) {
    console.error('Google sign in error:', error)
    return { data: null, error }
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    return { error: null }
  } catch (error) {
    console.error('Sign out error:', error)
    return { error }
  }
}

export async function verifyOrCreateCustomerRecord(user: any) {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('customers')
      .select('id')
      .eq('email', user.email)
      .maybeSingle()

    if (fetchError) throw fetchError

    if (!existing) {
      await supabase.from('customers').insert({
        email: user.email,
        company: user.user_metadata?.company || null,
      })
    }
  } catch (error) {
    console.warn('Error verifying/creating customer record:', error)
  }
}

export async function getCurrentUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) throw error
    return { user, error: null }
  } catch (error) {
    return { user: null, error }
  }
}
