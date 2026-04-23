import { useEffect, useRef, useState } from 'react'
import type { Workout, WorkoutPrediction } from '../model/workouts'
import type { PM5State, PM5Status } from '../lib/pm5State'
import { RowingDisplay } from './RowingDisplay'

export interface PM5ControlsProps {
  workout: Workout | null
  prediction: WorkoutPrediction | null
  pm5: PM5State
}

export function PM5Controls({ workout, prediction, pm5 }: PM5ControlsProps) {
  const [showDisplay, setShowDisplay] = useState(false)

  // Auto-open the rowing display once an upload completes. We only fire on
  // the uploading→done transition, so navigating into the PM5 tab while
  // status is already 'done' from a prior upload doesn't re-launch it.
  const prevStatus = useRef<PM5Status | null>(null)
  useEffect(() => {
    if (prevStatus.current === 'uploading' && pm5.status === 'done') {
      setShowDisplay(true)
    }
    prevStatus.current = pm5.status
  }, [pm5.status])

  const connected =
    pm5.status === 'ready' || pm5.status === 'uploading' || pm5.status === 'done'

  return (
    <>
      <div className="pm5-panel">
        {(pm5.status === 'idle' || pm5.status === 'error') && (
          <div className="pm5-cta">
            <button
              type="button"
              className="pm5-primary-btn"
              onClick={pm5.connect}
              disabled={!workout}
            >
              Connect to erg
            </button>
            <p className="pm5-hint">
              Press <strong>Connect</strong> on the PM5 menu to make it discoverable.
            </p>
          </div>
        )}

        {pm5.status === 'connecting' && (
          <p className="pm5-status">Connecting…</p>
        )}

        {connected && (
          <div className="pm5-cta">
            <div className="pm5-connection">
              <span className="pm5-device">Connected to {pm5.deviceName}</span>
              <button type="button" className="pm5-link" onClick={pm5.disconnect}>
                Disconnect
              </button>
            </div>
            <button
              type="button"
              className="pm5-primary-btn"
              onClick={() => workout && pm5.send(workout, prediction?.perIntervalSplitsSeconds)}
              disabled={!workout || pm5.status === 'uploading'}
            >
              {pm5.status === 'uploading' ? 'Uploading…' : 'Ready ✓'}
            </button>
          </div>
        )}

        {pm5.error && <p className="pm5-error">{pm5.error}</p>}
      </div>
      {showDisplay && workout && prediction && pm5.conn && (
        <RowingDisplay
          workout={workout}
          prediction={prediction}
          conn={pm5.conn}
          onClose={() => setShowDisplay(false)}
        />
      )}
    </>
  )
}
