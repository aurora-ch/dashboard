import { supabase, isSupabaseEnabled } from './supabase'

/**
 * Authentication service for Aurora Dashboard
 */

/**
 * Sign up with email and password.
 * Supabase sends a 6-digit OTP to the email for verification.
 * Requires "OTP" mode enabled in: Supabase Dashboard → Authentication → Email → Confirm email → OTP
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: { first_name?: string; last_name?: string; phone?: string }
) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) throw error

    return { data, error: null }
  } catch (error) {
    console.error('Sign up error:', error)
    return { data: null, error }
  }
}

/**
 * Verify the 6-digit OTP sent to email after sign up.
 */
export async function verifyEmailOtp(email: string, token: string) {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    })

    if (error) throw error

    if (data.user) {
      await verifyOrCreateCustomerRecord(data.user)
    }

    return { data, error: null }
  } catch (error) {
    console.error('OTP verification error:', error)
    return { data: null, error }
  }
}

/**
 * Resend the email verification OTP.
 */
export async function resendVerificationEmail(email: string) {
  try {
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    if (error) throw error
    return { data, error: null }
  } catch (error) {
    console.error('Resend OTP error:', error)
    return { data: null, error }
  }
}

/**
 * Sign in with email and password.
 */
export async function signInWithEmail(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

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

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  try {
    if (!isSupabaseEnabled) {
      return {
        data: null,
        error: {
          message:
            'Supabase is not configured. Please configure your Supabase credentials in .env.local',
        },
      }
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) throw error
    return { data, error: null }
  } catch (error) {
    console.error('Google sign in error:', error)
    return { data: null, error }
  }
}

/**
 * Sign out
 */
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

/**
 * Verify or create customer record for authenticated user.
 * Called automatically after sign in / OTP verification.
 */
export async function verifyOrCreateCustomerRecord(user: any) {
  try {
    const { data: existingCustomer, error: fetchError } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError
    }

    if (!existingCustomer) {
      const { error: insertError } = await supabase.from('customers').insert({
        user_id: user.id,
        email: user.email,
        first_name: user.user_metadata?.first_name || user.user_metadata?.name,
        last_name: user.user_metadata?.last_name,
        phone: user.user_metadata?.phone,
      })

      if (insertError) throw insertError
    }

    return existingCustomer
  } catch (error) {
    console.error('Error verifying/creating customer record:', error)
    throw error
  }
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser() {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error) throw error

    if (user) {
      await verifyOrCreateCustomerRecord(user)
    }

    return { user, error: null }
  } catch (error) {
    console.error('Get user error:', error)
    return { user: null, error }
  }
}

/**
 * Get customer data for current user
 */
export async function getCustomerData() {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) throw authError
    if (!user) throw new Error('Not authenticated')

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*, companies(*)')
      .eq('user_id', user.id)
      .single()

    if (customerError) throw customerError

    return { customer, error: null }
  } catch (error) {
    console.error('Get customer data error:', error)
    return { customer: null, error }
  }
}

/**
 * Update customer profile
 */
export async function updateCustomerProfile(data: {
  first_name?: string
  last_name?: string
  phone?: string
  title?: string
  business_url?: string
}) {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) throw authError
    if (!user) throw new Error('Not authenticated')

    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update(data)
      .eq('user_id', user.id)
      .select()
      .single()

    if (updateError) throw updateError

    return { data: updated, error: null }
  } catch (error) {
    console.error('Update profile error:', error)
    return { data: null, error }
  }
}
