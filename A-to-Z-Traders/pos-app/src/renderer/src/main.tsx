import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element is missing from index.html.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
