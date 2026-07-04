import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { LanguageProvider } from './i18n/LanguageContext.jsx'
import { TripBasketProvider } from './context/TripBasketContext.jsx'
import './styles/global.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'

if (import.meta.env.VITE_SENTRY_DSN) Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary><LanguageProvider>
        <TripBasketProvider>
          <App />
        </TripBasketProvider>
      </LanguageProvider></ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
)
