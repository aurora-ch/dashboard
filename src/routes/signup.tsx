import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { BusinessSetup } from '@/features/aurora-dashboard/components/business-setup'
import { ThemeSwitch } from '@/components/theme-switch'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()
  const { user, loading } = useAuthStore((state) => state.auth)

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: '/dashboard' })
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeSwitch />
      </div>
      <BusinessSetup
        initialView="signup"
        onComplete={() => navigate({ to: '/dashboard' })}
      />
    </div>
  )
}
