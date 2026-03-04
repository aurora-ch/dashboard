import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const { loading } = useAuthStore.getState().auth

    // Wait for the auth store to finish its initial session check
    if (loading) {
      await new Promise<void>((resolve) => {
        const unsubscribe = useAuthStore.subscribe((state) => {
          if (!state.auth.loading) {
            unsubscribe()
            resolve()
          }
        })
      })
    }

    const currentUser = useAuthStore.getState().auth.user
    if (!currentUser) {
      // Check if user has ever signed up on this browser
      const hasStoredAuth =
        typeof localStorage !== 'undefined' &&
        Object.keys(localStorage).some(
          (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
        )

      throw redirect({
        to: hasStoredAuth ? '/login' : '/signup',
        search: { redirect: window.location.pathname },
      })
    }
  },
  component: AuthenticatedLayout,
})
