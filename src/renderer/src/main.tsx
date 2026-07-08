import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './store'
import './index.css'

// Collected by the smoke test to catch renderer-side breakage.
window.__dollarErrors = []
window.addEventListener('error', (e) => window.__dollarErrors!.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => window.__dollarErrors!.push(String(e.reason)))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
