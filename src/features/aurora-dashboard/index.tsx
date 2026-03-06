import { useState, useEffect, lazy, Suspense } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useCustomerSync } from '@/hooks/use-customer-sync'
import { useWebhookListener } from '@/hooks/use-webhook-listener'
import { useTranslation } from '@/lib/translations'
import { useWebhookNotificationsStore } from '@/stores/webhook-notifications-store'
import { getCustomerId } from '@/lib/vapi-api-key'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { LanguageSelector } from '@/components/language-selector'
import { WebhookSidebar } from '@/components/webhook-sidebar'
import { PlanBadge } from '@/components/plan-badge'
import { CallManagerButton } from '@/components/call-manager-button'
import { StatsCards } from './components/stats-cards'
import { BusinessSetup } from './components/business-setup'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Lazy load heavy components to improve initial page load
const CallDetails = lazy(() => import('./components/call-details').then(m => ({ default: m.CallDetails })))
const CallTimelineGraph = lazy(() => import('./components/call-timeline-graph').then(m => ({ default: m.CallTimelineGraph })))

export function AuroraDashboard() {
  const { user, loading } = useAuthStore((state) => state.auth)
  const t = useTranslation()
  const [needsSetup, setNeedsSetup] = useState(false)
  const notifications = useWebhookNotificationsStore((state) => state.notifications)
  const currentCustomerId = getCustomerId()
  const hasNotification = notifications.some(n => n.customer_id === currentCustomerId)
  
  // Sync user to customers table - Hook handles delay internally
  useCustomerSync()
  
  // Listen for webhook events in real-time - Hook handles delay internally
  useWebhookListener()

  useEffect(() => {
    // Show setup/login screen if user is not authenticated
    if (!loading && !user) {
      setNeedsSetup(true)
    } else if (user) {
      setNeedsSetup(false)
    }
  }, [user, loading])

  const handleSetupComplete = () => {
    setNeedsSetup(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">{t.dashboard.loading}</div>
      </div>
    )
  }

  if (needsSetup) {
    return (
      <>
        <Header showSidebarTrigger={false}>
          <TopNav links={topNav} />
          <div className="ms-auto flex items-center space-x-4">
            <PlanBadge />
            <LanguageSelector />
            <ThemeSwitch />
            <ProfileDropdown />
          </div>
        </Header>
        <Main>
          <BusinessSetup initialView="login" onComplete={handleSetupComplete} />
        </Main>
      </>
    )
  }

  return (
    <>
      <Header>
        <TopNav links={topNav} />
        <div className="ms-auto flex items-center space-x-4">
          <PlanBadge />
          <LanguageSelector />
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      {/* Webhook Sidebar - Shows on the right when a notification is received */}
      <WebhookSidebar />

      <Main className={hasNotification ? 'mr-96 transition-all duration-300' : 'transition-all duration-300'}>
        <div className="space-y-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {t.dashboard.welcomeBackName.replace('{name}', user?.user_metadata?.first_name || user?.email?.split('@')[0] || '')}
              </h1>
              <p className="text-muted-foreground">
                {t.dashboard.overview}
              </p>
            </div>
            <CallManagerButton />
          </div>

          {/* Stats Cards */}
          <StatsCards />

          {/* Call Timeline Graph - Lazy loaded */}
          <Suspense fallback={
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-5 w-48" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-[400px] w-full" />
              </CardContent>
            </Card>
          }>
            <CallTimelineGraph />
          </Suspense>

          {/* VAPI Information Grid - Lazy loaded */}
          <div className="grid gap-6 lg:grid-cols-1">
            <Suspense fallback={
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded" />
                    <Skeleton className="h-5 w-48" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="border rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          <Skeleton className="h-4 w-4 rounded" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-24" />
                          </div>
                          <Skeleton className="h-5 w-16 rounded-full" />
                          <Skeleton className="h-8 w-12 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            }>
              <CallDetails />
            </Suspense>
          </div>
        </div>
      </Main>
    </>
  )
}

const topNav = [
  {
    title: 'Dashboard',
    href: '/',
    isActive: true,
    disabled: false,
  },
]

