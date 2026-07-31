import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { LanguageProvider } from './i18n/LanguageContext.jsx'
import { TripBasketProvider } from './context/TripBasketContext.jsx'
import './styles/global.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const canonical = `${window.location.origin}${window.location.pathname}`
document.querySelector('[data-runtime-canonical]')?.setAttribute('href', canonical)
document.querySelector('[data-runtime-url]')?.setAttribute('content', canonical)

if (import.meta.env.VITE_SENTRY_DSN) Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider><ErrorBoundary>
        <TripBasketProvider>
          <App />
        </TripBasketProvider>
      </ErrorBoundary></LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
)
