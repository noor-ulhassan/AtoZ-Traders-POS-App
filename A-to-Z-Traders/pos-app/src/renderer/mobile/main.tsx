import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element is missing from mobile.html.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)

/**
 * Registered only in the built app.
 *
 * A service worker in front of the Vite dev server intercepts the very module
 * requests hot reloading depends on, and produces the kind of "why is my
 * change not showing" afternoon that is hard to diagnose and easy to avoid.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/mobile-sw.js').catch(() => {
      // No service worker means no offline shell — the app still works fully
      // on the shop Wi-Fi, which is where it spends its life. Not worth a
      // message to somebody standing at a counter.
    })
  })
}
