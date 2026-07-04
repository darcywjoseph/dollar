import React, { useState } from 'react'
import { Layout, type Page } from './components/Layout'
import { Spinner } from './components/ui'
import { useApp } from './appContext'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Income from './pages/Income'
import Budgets from './pages/Budgets'
import Goals from './pages/Goals'
import Forecast from './pages/Forecast'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

export default function App(): React.JSX.Element {
  const { ready } = useApp()
  const [page, setPage] = useState<Page>('dashboard')

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <Layout page={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
      {page === 'transactions' && <Transactions />}
      {page === 'income' && <Income />}
      {page === 'budgets' && <Budgets />}
      {page === 'goals' && <Goals />}
      {page === 'forecast' && <Forecast />}
      {page === 'reports' && <Reports />}
      {page === 'settings' && <Settings />}
    </Layout>
  )
}
