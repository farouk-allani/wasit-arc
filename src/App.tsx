import { useState } from 'react'
import { Header } from './components/Header'
import { NetworkGuard } from './components/NetworkGuard'
import { Home } from './pages/Home'
import { CreateDeal } from './pages/CreateDeal'
import { MyDeals } from './pages/MyDeals'
import { DealPage } from './pages/DealPage'

type Page =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'deals' }
  | { name: 'deal'; id: string }

export default function App() {
  const [page, setPage] = useState<Page>({ name: 'home' })

  function navigate(to: 'home' | 'create' | 'deals') {
    if (to === 'home') setPage({ name: 'home' })
    else if (to === 'create') setPage({ name: 'create' })
    else setPage({ name: 'deals' })
  }

  function openDeal(id: string) {
    setPage({ name: 'deal', id })
  }

  const currentTopLevel =
    page.name === 'deal' ? 'deal' : page.name

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
        onNavigate={navigate}
      />

      <NetworkGuard>
        {page.name === 'home' && <Home onNavigate={navigate} />}
        {page.name === 'create' && <CreateDeal />}
        {page.name === 'deals' && <MyDeals onOpenDeal={openDeal} />}
        {page.name === 'deal' && <DealPage dealId={page.id} />}
      </NetworkGuard>
    </div>
  )
}
