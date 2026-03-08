import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Mail, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-react'

export interface BusinessSetupProps {
  initialView: 'login' | 'signup'
  onComplete: () => void
}

function parseAuthError(error: any): string {
  const msg: string = error?.message ?? error?.msg ?? String(error ?? '')

  if (
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('User already registered')
  )
    return 'already-registered'

  if (
    msg.includes('Invalid login credentials') ||
    msg.includes('invalid_credentials') ||
    msg.includes('Invalid email or password')
  )
    return 'invalid-credentials'

  if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed'))
    return 'email-not-confirmed'

  if (msg.includes('rate limit') || msg.includes('too many requests'))
    return 'rate-limit'

  return msg || 'unknown'
}

/**
 * Pre-login checks against signups + free_users tables.
 * Returns null if all good, or an error message string to display.
 */
async function checkLoginEligibility(
  email: string
): Promise<{ allowed: boolean; reason: 'not-registered' | 'not-allowed' | null }> {
  const normalised = email.trim().toLowerCase()

  // 1. Is the email registered at all?
  const { data: signup } = await supabase
    .from('signups')
    .select('id')
    .eq('email', normalised)
    .maybeSingle()

  if (!signup) {
    return { allowed: false, reason: 'not-registered' }
  }

  // 2. Is the user in the free_users (allowed) list?
  const { data: freeUser } = await supabase
    .from('free_users')
    .select('id')
    .eq('email', normalised)
    .maybeSingle()

  if (!freeUser) {
    return { allowed: false, reason: 'not-allowed' }
  }

  return { allowed: true, reason: null }
}

export function BusinessSetup({ initialView, onComplete }: BusinessSetupProps) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'not-registered' | 'not-allowed' | 'auth' | null>(null)

  const { signInWithEmail, signUpWithEmail } = useAuthStore((s) => s.auth)

  const isLogin = initialView === 'login'

  const clearError = () => {
    setError(null)
    setErrorType(null)
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    clearError()
    setIsLoading(true)

    // Pre-check: registered + allowed?
    const { allowed, reason } = await checkLoginEligibility(email)

    if (!allowed) {
      setIsLoading(false)
      setErrorType(reason)
      if (reason === 'not-registered') {
        setError(
          "No account found for this email. You haven't signed up yet — create an account first."
        )
      } else {
        setError(
          "Your account is not authorised to log in. Please contact Aurora support."
        )
      }
      return
    }

    // Attempt login
    const { error: signInError } = await signInWithEmail(email.trim(), password)

    if (!signInError) {
      // Track this login: increment login_count + last_login_at
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.rpc('track_user_login', { p_user_id: user.id })
      }
      setIsLoading(false)
      toast.success('Welcome back!')
      onComplete()
      return
    }

    setIsLoading(false)
    setErrorType('auth')
    const code = parseAuthError(signInError)
    if (code === 'invalid-credentials') {
      setError('Wrong password. Try again.')
    } else if (code === 'rate-limit') {
      setError('Too many attempts. Please wait a moment and try again.')
    } else {
      setError(signInError?.message ?? 'Sign in failed. Please try again.')
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    clearError()
    setIsLoading(true)

    const { error: signUpError, needsVerification } = await signUpWithEmail(
      email.trim(),
      password
    )

    if (signUpError) {
      setIsLoading(false)
      const code = parseAuthError(signUpError)
      if (code === 'already-registered') {
        setError('An account with this email already exists. Please sign in instead.')
        setErrorType('auth')
      } else if (code === 'rate-limit') {
        setError('Too many attempts. Please wait a moment and try again.')
      } else {
        setError(signUpError?.message ?? 'Sign up failed. Please try again.')
      }
      return
    }

    if (needsVerification) {
      const { error: signInError } = await signInWithEmail(email.trim(), password)
      setIsLoading(false)
      if (!signInError) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.rpc('track_user_login', { p_user_id: user.id })
        }
        toast.success('Account created! Welcome to Aurora.')
        onComplete()
      } else {
        setError('Account created — please sign in to continue.')
        navigate({ to: '/login' })
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.rpc('track_user_login', { p_user_id: user.id })
      }
      setIsLoading(false)
      toast.success('Account created! Welcome to Aurora.')
      onComplete()
    }
  }

  const goToSignUp = () => { clearError(); setPassword(''); navigate({ to: '/signup' }) }
  const goToSignIn = () => { clearError(); setPassword(''); navigate({ to: '/login' }) }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex justify-center">
        <img
          src="/logos/aurora-logo.png"
          alt="Aurora"
          className="h-12 w-12 object-contain"
        />
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {isLogin ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isLogin
            ? 'Sign in to access your Aurora dashboard'
            : 'Enter your work email to get started'}
        </p>
      </div>

      <form
        onSubmit={isLogin ? handleSignIn : handleSignUp}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="auth-email">Work email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError() }}
              placeholder="you@company.com"
              required
              disabled={isLoading}
              className="pl-9"
              autoComplete="email"
              autoFocus
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="auth-password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError() }}
              placeholder={isLogin ? 'Your password' : 'Min. 8 characters'}
              required
              disabled={isLoading}
              className="pl-9 pr-10"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {!isLogin && (
            <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
          )}
        </div>

        {error && (
          <div className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2 space-y-1.5">
            <p>{error}</p>
            {errorType === 'not-registered' && (
              <button
                type="button"
                onClick={goToSignUp}
                className="font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                Create an account →
              </button>
            )}
          </div>
        )}

        <Button
          type="submit"
          disabled={isLoading || !email.trim() || !password}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {isLogin ? 'Signing in…' : 'Creating account…'}
            </>
          ) : (
            <>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {isLogin ? 'Sign in' : 'Create account'}
            </>
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={isLogin ? goToSignUp : goToSignIn}
          className="font-medium text-foreground underline-offset-4 hover:underline"
          disabled={isLoading}
        >
          {isLogin ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}
