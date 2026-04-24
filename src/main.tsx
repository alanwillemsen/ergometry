import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Concept2Callback } from './components/Concept2Callback'
import { CONCEPT2_CALLBACK_PATH } from './lib/concept2/config'

// Route the OAuth callback before App mounts so App's hooks aren't invoked
// conditionally (rules-of-hooks).
const root = location.pathname === CONCEPT2_CALLBACK_PATH
  ? <Concept2Callback />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {root}
  </StrictMode>,
)
