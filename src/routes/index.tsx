import { createFileRoute, redirect } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'

/**
 * Smart root redirect:
 *  - Valid session            → /dashboard
 *  - Expired session stored   → /login   (user has an account, just needs to sign in again)
 *  - No trace of any session  → /signup  (brand-new visitor)
 */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    // Ask Supabase for the current session.
    // If a refresh token is stored it will silently refresh and return a valid session.
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session) {
      throw redirect({ to: '/dashboard' })
    }

    // No live session — check whether this browser has ever stored a Supabase
    // auth token (any key matching sb-*-auth-token in localStorage).
    const hasStoredAuth =
      typeof localStorage !== 'undefined' &&
      Object.keys(localStorage).some(
        (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
      )

    if (hasStoredAuth) {
      // Returning user whose token expired — send to sign-in
      throw redirect({ to: '/login' })
    }

    // First-time visitor — send to sign-up
    throw redirect({ to: '/signup' })
  },
  component: () => null,
})
