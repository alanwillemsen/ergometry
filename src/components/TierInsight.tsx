import { useMemo, useState } from 'react'
import type { FittedProfile } from '../model/pacing'
import { splitFromPower, impliedDistanceTime } from '../model/pacing'
import { formatSplit, formatTime } from '../lib/time'

export function TierInsight({
  fit,
  sixKProvided = false,
}: {
  fit: FittedProfile
  sixKProvided?: boolean
}) {
  const [open, setOpen] = useState(false)

  const insight = useMemo(() => {
    const sustainableSplit = splitFromPower(fit.cpWatts)
    const sixK = impliedDistanceTime(fit.cpWatts, fit.wPrimeJoules, 6000)
    return { sustainableSplit, sixK }
  }, [fit])

  return (
    <div className="insight-wrap">
      <button
        type="button"
        className="insight-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾ Hide model details' : '▸ Show model details'}
      </button>
      {open && (
        <div className="insight">
          <div className="insight-row">
            <span className="insight-label">Sustainable pace</span>
            <code>{formatSplit(insight.sustainableSplit)} /500m</code>
            <span className="insight-note">
              roughly the split you could hold indefinitely (<code>Critical Power</code> ={' '}
              {fit.cpWatts.toFixed(0)} W)
            </span>
          </div>
          <div className="insight-row">
            <span className="insight-label">Sprint reserve</span>
            <code>{(fit.wPrimeJoules / 1000).toFixed(1)} kJ</code>
            <span className="insight-note">
              extra anaerobic energy for going above sustainable pace (
              <code>W′</code>)
            </span>
          </div>
          {!sixKProvided && (
            <div className="insight-row">
              <span className="insight-label">Implied 6K</span>
              <code>{formatTime(insight.sixK)}</code>
              <span className="insight-note">
                model estimate for an all-out 6K ({formatSplit(insight.sixK / 12)}
                /500m)
              </span>
            </div>
          )}
          <p className="insight-source">
            {fit.source === 'tier'
              ? 'Derived from your 2K time and chosen tier.'
              : fit.source === 'tier+refinement'
                ? 'Fit from your 2K and 6K times.'
                : 'Using your custom fitness profile.'}{' '}
            Predictions use a Critical-Power model with the Skiba integral W′bal
            simulator for interval fatigue, a Morton 3-parameter ceiling on short
            reps (asymptotes to peak power at ~10s rather than flat-topping),
            and a small long-duration decay above 20 minutes.
          </p>
        </div>
      )}
    </div>
  )
}
