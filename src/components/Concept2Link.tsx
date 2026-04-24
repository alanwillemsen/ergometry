import type { Concept2State } from '../lib/concept2State'

export interface Concept2LinkProps {
  concept2: Concept2State
}

// Profile-tab affordance for connecting/disconnecting the Logbook. The upload
// button itself lives on the rowing display.
export function Concept2Link({ concept2 }: Concept2LinkProps) {
  if (concept2.status === 'unconfigured') {
    return (
      <div className="concept2-link">
        <p className="hint">
          Concept2 Logbook integration isn't configured. Set
          {' '}<code>VITE_CONCEPT2_*</code> in <code>.env.local</code>.
        </p>
      </div>
    )
  }

  const connected =
    concept2.status === 'connected' ||
    concept2.status === 'uploading' ||
    concept2.status === 'upload-done'

  return (
    <div className="concept2-link">
      {connected ? (
        <>
          <div className="concept2-status">
            <span>
              <strong>Logbook connected</strong>
              {concept2.user?.username ? ` as ${concept2.user.username}` : ''}
            </span>
            <button
              type="button"
              className="pm5-link"
              onClick={concept2.disconnect}
            >
              Disconnect
            </button>
          </div>
          <p className="hint">
            After a workout, upload your result from the rowing display.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="share-button"
            onClick={concept2.connect}
            disabled={concept2.status === 'connecting'}
          >
            {concept2.status === 'connecting' ? 'Redirecting…' : 'Connect Concept2 Logbook'}
          </button>
          <p className="hint">
            Authorize once; workouts can then be uploaded to your logbook when you finish.
          </p>
        </>
      )}
      {concept2.error && <p className="error">{concept2.error}</p>}
    </div>
  )
}
