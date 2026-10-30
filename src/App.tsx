/**
 * App — thin shell with History API path routing.
 *
 * Routes:
 *   /            → Home
 *   /create      → CreateDeal
 *   /deals       → MyDeals
 *   /deal/:id    → DealPage
 *
 * A refresh on any deep path restores the correct page.
 * Back/Forward work via popstate. vercel.json rewrites all paths to /index.html.
 */
import { useState, useEffect, useCallback } from 'react'
import { Header } from './components/Header'
import { NetworkGuard } from './components/NetworkGuard'
import { Home } from './pages/Home'
import { CreateDeal } from './pages/CreateDeal'
import { MyDeals } from './pages/MyDeals'
import { DealPage } from './pages/DealPage'

// ── Route parsing ─────────────────────────────────────────────────────────────
type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'deals' }
  | { name: 'deal'; id: string }

function parsePath(pathname: string): Route {
  const p = pathname.replace(/\/$/, '') || '/'
  if (p === '/' || p === '') return { name: 'home' }
  if (p === '/create') return { name: 'create' }
  if (p === '/deals') return { name: 'deals' }
  const dealMatch = p.match(/^\/deal\/(\d+)$/)
  if (dealMatch) return { name: 'deal', id: dealMatch[1] }
  // Unknown path — fall back to home
  return { name: 'home' }
}

function routeToPath(route: Route): string {
  if (route.name === 'home') return '/'
  if (route.name === 'create') return '/create'
  if (route.name === 'deals') return '/deals'
  return `/deal/${route.id}`
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname))

  // Keep route in sync with browser back/forward
  useEffect(() => {
    function onPop() {
      setRoute(parsePath(window.location.pathname))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: Route) => {
    const path = routeToPath(to)
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setRoute(to)
  }, [])

  const goHome    = useCallback(() => navigate({ name: 'home' }), [navigate])
  const goCreate  = useCallback(() => navigate({ name: 'create' }), [navigate])
  const goDeals   = useCallback(() => navigate({ name: 'deals' }), [navigate])
  const openDeal  = useCallback((id: string) => navigate({ name: 'deal', id }), [navigate])

  // Header needs the top-level section name (deal page counts as 'deal')
  const currentTopLevel = route.name === 'deal' ? 'deal' : route.name

  // onNavigate prop used by Home and CreateDeal
  function onNavigate(to: 'home' | 'create' | 'deals') {
    if (to === 'home') goHome()
    else if (to === 'create') goCreate()
    else goDeals()
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--background)',
        color: 'var(--foreground)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <Header
        currentPage={currentTopLevel}
        onNavigate={onNavigate}
        isHero={route.name === 'home'}
      />

      <NetworkGuard>
        {route.name === 'home'   && <Home onNavigate={onNavigate} />}
        {route.name === 'create' && (
          <CreateDeal onSuccess={(id) => openDeal(id)} />
        )}
        {route.name === 'deals'  && (
          <MyDeals onOpenDeal={openDeal} onCreateDeal={goCreate} />
        )}
        {route.name === 'deal'   && (
          <DealPage dealId={route.id} onBack={goDeals} />
        )}
      </NetworkGuard>
    </div>
  )
}
