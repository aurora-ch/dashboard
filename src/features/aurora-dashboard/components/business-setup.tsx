import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Mail, Lock, ArrowLeft, RefreshCw, ShieldCheck, Eye, EyeOff } from 'lucide-react'

type AuthView = 'login' | 'signup' | 'verify-otp'

interface BusinessSetupProps {
  onComplete: () => void
}

const RESEND_COOLDOWN = 60

function parseAuthError(error: any): string {
  const msg: string = error?.message ?? error?.msg ?? String(error ?? '')

  if (
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('User already registered')
  ) {
    return 'already-registered'
  }
  if (
    msg.includes('Invalid login credentials') ||
    msg.includes('invalid_credentials') ||
    msg.includes('Invalid email or password')
  ) {
    return 'invalid-credentials'
  }
  if (
    msg.includes('Email not confirmed') ||
    msg.includes('email_not_confirmed')
  ) {
    return 'email-not-confirmed'
  }
  if (msg.includes('Token has expired') || msg.includes('otp_expired')) {
    return 'otp-expired'
  }
  if (
    msg.includes('Invalid OTP') ||
    msg.includes('invalid_otp') ||
    msg.includes('Token is invalid')
  ) {
    return 'otp-invalid'
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate-limit'
  }
  return msg || 'unknown'
}

export function BusinessSetup({ onComplete }: BusinessSetupProps) {
  const [view, setView] = useState<AuthView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { signInWithEmail, signUpWithEmail, verifyOtp, resendOtp } =
    useAuthStore((s) => s.auth)

  // Clear error when user switches view or types
  const clearError = () => setError(null)

  const startResendCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  // ─── Sign In ─────────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    clearError()
    setIsLoading(true)

    const { error: signInError } = await signInWithEmail(
      email.trim(),
      password
    )

    setIsLoading(false)

    if (!signInError) {
      toast.success('Welcome back!')
      onComplete()
      return
    }

    const code = parseAuthError(signInError)

    if (code === 'email-not-confirmed') {
      setError(
        'Your email is not verified yet. Sign up again to receive a new verification code.'
      )
    } else if (code === 'invalid-credentials') {
      setError(
        'Invalid email or password. No account? Click "Create account" below.'
      )
    } else if (code === 'rate-limit') {
      setError('Too many attempts. Please wait a moment and try again.')
    } else {
      setError(signInError?.message ?? 'Sign in failed. Please try again.')
    }
  }

  // ─── Sign Up ─────────────────────────────────────────────────────────────────
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

    setIsLoading(false)

    if (!signUpError) {
      if (needsVerification) {
        // OTP sent – move to verification step
        toast.success('Verification code sent! Check your inbox.')
        startResendCooldown()
        setOtp('')
        setView('verify-otp')
      } else {
        // Email confirmation disabled in project – direct login
        toast.success('Account created! Welcome.')
        onComplete()
      }
      return
    }

    const code = parseAuthError(signUpError)

    if (code === 'already-registered') {
      setError(
        'An account with this email already exists. Please sign in instead.'
      )
    } else if (code === 'rate-limit') {
      setError('Too many attempts. Please wait a moment and try again.')
    } else {
      setError(signUpError?.message ?? 'Sign up failed. Please try again.')
    }
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return
    clearError()
    setIsLoading(true)

    const { error: otpError } = await verifyOtp(email.trim(), otp)

    setIsLoading(false)

    if (!otpError) {
      toast.success('Email verified! Welcome to Aurora.')
      onComplete()
      return
    }

    const code = parseAuthError(otpError)
    setOtp('')

    if (code === 'otp-expired') {
      setError(
        'Verification code expired. Click "Resend code" to get a new one.'
      )
    } else if (code === 'otp-invalid') {
      setError('Invalid code. Please check your email and try again.')
    } else {
      setError(otpError?.message ?? 'Verification failed. Please try again.')
    }
  }

  // Auto-verify when all 6 digits are entered
  useEffect(() => {
    if (view === 'verify-otp' && otp.length === 6) {
      handleVerifyOtp()
    }
  }, [otp]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Resend OTP ───────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return
    clearError()

    const { error: resendError } = await resendOtp(email.trim())

    if (!resendError) {
      toast.success('New verification code sent!')
      startResendCooldown()
    } else {
      toast.error('Could not resend code. Please try again.')
    }
  }

  const switchToSignUp = () => {
    clearError()
    setPassword('')
    setView('signup')
  }

  const switchToLogin = () => {
    clearError()
    setPassword('')
    setView('login')
  }

  // ─── OTP Verification View ────────────────────────────────────────────────────
  if (view === 'verify-otp') {
    return (
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="/logos/aurora-logo.png"
            alt="Aurora"
            className="h-12 w-12 object-contain"
          />
        </div>

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to
          </p>
          <p className="text-sm font-medium">{email}</p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Label className="text-sm text-muted-foreground">
              Enter verification code
            </Label>
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={setOtp}
              disabled={isLoading}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={1} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={2} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={3} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={4} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={5} className="h-12 w-12 text-lg" />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {isLoading && (
            <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Verifying…
            </p>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Resend */}
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Didn't receive it?</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResend}
            disabled={resendCooldown > 0 || isLoading}
            className="w-full"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : 'Resend code'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Check your spam folder if you don't see it.
          </p>
        </div>

        {/* Back */}
        <button
          type="button"
          onClick={switchToLogin}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </button>
      </div>
    )
  }

  const isLogin = view === 'login'

  // ─── Login / Sign Up View ─────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-sm space-y-8">
      {/* Logo */}
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
        {/* Email */}
        <div className="space-y-1.5">
          <Label htmlFor="auth-email">Work email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearError()
              }}
              placeholder="you@company.com"
              required
              disabled={isLoading}
              className="pl-9"
              autoComplete="email"
              autoFocus
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <Label htmlFor="auth-password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="auth-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearError()
              }}
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
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {!isLogin && (
            <p className="text-xs text-muted-foreground">
              Minimum 8 characters
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2">
            {error}
          </p>
        )}

        {/* Submit */}
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

      {/* Toggle */}
      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={isLogin ? switchToSignUp : switchToLogin}
          className="font-medium text-foreground underline-offset-4 hover:underline"
          disabled={isLoading}
        >
          {isLogin ? 'Create account' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}
