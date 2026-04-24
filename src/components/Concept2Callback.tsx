import { useEffect, useState } from 'react'
import { exchangeCodeForToken } from '../lib/concept2/oauth'
import { consumeOAuthState, consumeReturnPath, saveToken } from '../lib/concept2/tokens'

// Module-level guard so React StrictMode's dev mount → unmount → remount cycle
// (or any other double-fire) doesn't exchange the same one-time code twice.
// The second call to Concept2 would otherwise fail with 400 "check the code",
// masking the fact that the first call already succeeded. Keyed by code so
// distinct OAuth flows aren't blocked by each other.
const attemptedCodes = new Set<string>()

interface Phase {
  status: 'exchanging' | 'error'
  message: string
  // Non-null when the async exchange should run.
  code: string | null
  returnTo: string
}

// Validates the callback URL synchronously so the initial render reflects the
// terminal state for malformed callbacks — no setState-in-effect cascade.
function initialPhase(): Phase {
  const url = new URL(location.href)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err   = url.searchParams.get('error')
  const expectedState = consumeOAuthState()
  const returnTo = consumeReturnPath()

  if (err) {
    return { status: 'error', message: `Concept2 rejected the request: ${err}`, code: null, returnTo }
  }
  if (!code || !state) {
    return { status: 'error', message: 'Callback missing code/state.', code: null, returnTo }
  }
  if (!expectedState || expectedState !== state) {
    return { status: 'error', message: 'State mismatch — possible CSRF. Try connecting again.', code: null, returnTo }
  }
  return { status: 'exchanging', message: 'Connecting to Concept2 Logbook…', code, returnTo }
}

export function Concept2Callback() {
  const [phase, setPhase] = useState<Phase>(initialPhase)

  useEffect(() => {
    if (phase.code === null) return
    if (attemptedCodes.has(phase.code)) return
    attemptedCodes.add(phase.code)
    // No cleanup/cancel flag: StrictMode's dev mount→cleanup→remount cycle
    // would otherwise flip cancelled=true on the in-flight first fetch, and
    // the guard above blocks the second fetch, leaving us stuck on
    // "Connecting…". Both saveToken and location.replace are idempotent.
    exchangeCodeForToken(phase.code)
      .then((token) => {
        saveToken(token)
        location.replace(phase.returnTo)
      })
      .catch((e: Error) => {
        setPhase((p) => ({ ...p, status: 'error', message: e.message }))
      })
  }, [phase.code, phase.returnTo])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ergometry</h1>
      </header>
      <section className="panel">
        <h2>{phase.status === 'error' ? 'Connection failed' : 'Connecting…'}</h2>
        <p className={phase.status === 'error' ? 'error' : 'panel-intro'}>{phase.message}</p>
        {phase.status === 'error' && (
          <button
            type="button"
            className="view-primary-btn"
            onClick={() => location.replace('/')}
          >
            Back to app
          </button>
        )}
      </section>
    </div>
  )
}
