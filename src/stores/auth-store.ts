import { create } from 'zustand'
import { User, Session } from '@supabase/supabase-js'
import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import {
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  signOut as authSignOut,
  verifyOrCreateCustomerRecord,
} from '@/lib/auth'

type AuthUser = User

interface AuthState {
  auth: {
    user: AuthUser | null
    session: Session | null
    loading: boolean
    setUser: (user: AuthUser | null) => void
    setSession: (session: Session | null) => void
    setLoading: (loading: boolean) => void
    signInWithEmail: (email: string, password: string) => Promise<{ error: any }>
    signInWithGoogle: () => Promise<{ error: any }>
    signUpWithEmail: (
      email: string,
      password: string,
      metadata?: { first_name?: string; last_name?: string; phone?: string }
    ) => Promise<{ error: any; needsVerification?: boolean }>
    signOut: () => Promise<void>
    reset: () => void
    initialize: () => Promise<void>
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  auth: {
    user: null,
    session: null,
    loading: true,

    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),

    setSession: (session) => {
      const user = session?.user ?? null
      set((state) => ({
        ...state,
        auth: { ...state.auth, session, user: user as AuthUser | null },
      }))
    },

    setLoading: (loading) =>
      set((state) => ({ ...state, auth: { ...state.auth, loading } })),

    signInWithEmail: async (email, password) => {
      const { data, error } = await signInWithEmail(email, password)
      if (data?.session) {
        get().auth.setSession(data.session)
      }
      return { error }
    },

    signInWithGoogle: async () => {
      const { error } = await signInWithGoogle()
      return { error }
    },

    signUpWithEmail: async (email, password, metadata) => {
      const { data, error } = await signUpWithEmail(email, password, metadata)
      if (error) return { error, needsVerification: false }

      if (data?.session) {
        get().auth.setSession(data.session)
        return { error: null, needsVerification: false }
      }

      return { error: null, needsVerification: true }
    },

    signOut: async () => {
      await authSignOut()
      get().auth.reset()
    },

    reset: () => {
      set((state) => ({
        ...state,
        auth: { ...state.auth, user: null, session: null },
      }))
    },

    initialize: async () => {
      try {
        if (!isSupabaseEnabled) {
          console.warn('Supabase is not configured. Skipping auth initialization.')
          get().auth.setLoading(false)
          return
        }

        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          if (error.message?.includes('DNS') || error.message?.includes('network')) {
            console.warn('Supabase connection error:', error.message)
            get().auth.setLoading(false)
            return
          }
          throw error
        }

        get().auth.setSession(session)

        if (session?.user) {
          try {
            await verifyOrCreateCustomerRecord(session.user)
          } catch (err) {
            console.warn('Failed to verify customer record:', err)
          }
        }

        supabase.auth.onAuthStateChange(async (_event, session) => {
          get().auth.setSession(session)
          if (session?.user) {
            try {
              await verifyOrCreateCustomerRecord(session.user)
            } catch (err) {
              console.warn('Failed to verify customer record:', err)
            }
          }
        })
      } catch (error) {
        console.error('Auth initialization error:', error)
      } finally {
        get().auth.setLoading(false)
      }
    },
  },
}))
