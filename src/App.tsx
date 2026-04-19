import { useEffect, useMemo, useState } from 'react'
import { fitProfile, type AthleteProfile } from './model/pacing'
import { TIER_DEFS, type Tier } from './model/tiers'
import { parseTime, formatTime, formatSplit } from './lib/time'
import { TierInsight } from './components/TierInsight'
import { WorkoutList } from './components/WorkoutList'
import {
  WorkoutBuilder,
  emptySegment,
  type EditableSegment,
} from './components/WorkoutBuilder'
import { loadState, saveState, type SavedWorkout } from './lib/storage'
import { buildShareUrl, buildWorkoutShareUrl, readHashState, readHashWorkout } from './lib/urlState'

const ALL_TIERS: Tier[] = ['world-class', 'competitive', 'recreational', 'custom']

type CustomMode = 'slider' | 'scores'
type Tab = 'profile' | 'library' | 'build'

const DEFAULTS = {
  twoKInput: '7:00',
  tier: 'competitive' as Tier,
  customMode: 'scores' as CustomMode,
  customRatio: 0.7,
  sixKInput: '',
  savedWorkouts: [] as SavedWorkout[],
  builderName: 'New workout',
  builderSegments: [emptySegment()],
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to execCommand
    }
  }
  // execCommand fallback for non-HTTPS contexts
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(el)
  }
}

function initialState() {
  const hash = readHashState()
  const stored = loadState()
  const src = hash ?? stored ?? null
  return {
    twoKInput: (src?.twoKInput as string) ?? DEFAULTS.twoKInput,
    tier: (src?.tier as Tier) ?? DEFAULTS.tier,
    customMode: (src?.customMode as CustomMode) ?? DEFAULTS.customMode,
    customRatio: (src?.customRatio as number) ?? DEFAULTS.customRatio,
    sixKInput: (src?.sixKInput as string) ?? DEFAULTS.sixKInput,
    savedWorkouts: (src?.savedWorkouts as SavedWorkout[]) ?? DEFAULTS.savedWorkouts,
    builderName: (src?.builderName as string) ?? DEFAULTS.builderName,
    builderSegments: (src?.builderSegments as EditableSegment[]) ?? DEFAULTS.builderSegments,
  }
}

function App() {
  const init = useMemo(initialState, [])

  // Profile state
  const [twoKInput, setTwoKInput] = useState(init.twoKInput)
  const [splitInput, setSplitInput] = useState(() => {
    const t = parseTime(init.twoKInput)
    return isFinite(t) && t > 0 ? formatSplit(t / 4) : ''
  })
  const [tier, setTier] = useState<Tier>(init.tier)
  const [customMode, setCustomMode] = useState<CustomMode>(init.customMode)
  const [customRatio, setCustomRatio] = useState(init.customRatio)
  const [sixKInput, setSixKInput] = useState(init.sixKInput)
  const [sixKSplitInput, setSixKSplitInput] = useState(() => {
    const t = parseTime(init.sixKInput)
    return isFinite(t) && t > 0 ? formatSplit(t / 12) : ''
  })

  // Library state
  const [savedWorkouts, setSavedWorkouts] = useState<SavedWorkout[]>(init.savedWorkouts)
  const [shareStatuses, setShareStatuses] = useState<Record<string, 'copied' | 'error'>>({})

  // Builder state
  const [builderName, setBuilderName] = useState(init.builderName)
  const [builderSegments, setBuilderSegments] = useState<EditableSegment[]>(init.builderSegments)
  const [editingId, setEditingId] = useState<string | null>(null)

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const stored = loadState()
    if (!stored) return 'profile'
    const t = parseTime((stored.twoKInput as string) ?? '')
    return isFinite(t) && t > 0 ? 'library' : 'profile'
  })
  const [profileShareStatus, setProfileShareStatus] = useState<'' | 'copied' | 'error'>('')
  const [sharedWorkout, setSharedWorkout] = useState<{ name: string; segments: EditableSegment[] } | null>(() => {
    const w = readHashWorkout()
    return w ? { name: w.name, segments: w.segments as EditableSegment[] } : null
  })

  // Clear workout hash from URL on load (profile hashes are cleared on share)
  useEffect(() => {
    if (sharedWorkout) {
      history.replaceState(null, '', location.pathname)
    }
  }, [])

  // Persist state
  useEffect(() => {
    saveState({ twoKInput, tier, customMode, customRatio, sixKInput, savedWorkouts, builderName, builderSegments })
  }, [twoKInput, tier, customMode, customRatio, sixKInput, savedWorkouts, builderName, builderSegments])

  // Derived profile
  const twoKSeconds = parseTime(twoKInput)
  const usingScores = tier === 'custom' && customMode === 'scores'
  const sixKSecondsRaw = usingScores && sixKInput ? parseTime(sixKInput) : NaN
  const sixKValid =
    isFinite(sixKSecondsRaw) &&
    isFinite(twoKSeconds) &&
    sixKSecondsRaw > 3 * twoKSeconds
  const sixKInvalid = usingScores && sixKInput !== '' && !sixKValid

  const profile: AthleteProfile | null = useMemo(() => {
    if (!isFinite(twoKSeconds) || twoKSeconds < 300 || twoKSeconds > 900) return null
    return {
      twoKSeconds,
      tier,
      customCpRatio: tier === 'custom' && customMode === 'slider' ? customRatio : undefined,
      sixKSeconds: sixKValid ? sixKSecondsRaw : undefined,
    }
  }, [twoKSeconds, tier, customMode, customRatio, sixKSecondsRaw, sixKValid])

  const fit = useMemo(() => (profile ? fitProfile(profile) : null), [profile])

  // Input handlers
  const onTwoKChange = (v: string) => {
    setTwoKInput(v)
    const t = parseTime(v)
    if (isFinite(t) && t > 0) setSplitInput(formatSplit(t / 4))
  }
  const onSplitChange = (v: string) => {
    setSplitInput(v)
    const s = parseTime(v)
    if (isFinite(s) && s > 0) setTwoKInput(formatTime(s * 4))
  }
  const onSixKChange = (v: string) => {
    setSixKInput(v)
    const t = parseTime(v)
    if (isFinite(t) && t > 0) setSixKSplitInput(formatSplit(t / 12))
  }
  const onSixKSplitChange = (v: string) => {
    setSixKSplitInput(v)
    const s = parseTime(v)
    if (isFinite(s) && s > 0) setSixKInput(formatTime(s * 12))
  }

  // Profile share
  const handleProfileShare = async () => {
    const url = buildShareUrl({ twoKInput, tier, customMode, customRatio, sixKInput })
    const ok = await copyToClipboard(url)
    if (ok) history.replaceState(null, '', url)
    setProfileShareStatus(ok ? 'copied' : 'error')
    setTimeout(() => setProfileShareStatus(''), 2000)
  }

  // Library actions
  const handleEditWorkout = (id: string) => {
    const w = savedWorkouts.find((sw) => sw.id === id)
    if (!w) return
    setBuilderName(w.name)
    setBuilderSegments(w.segments as EditableSegment[])
    setEditingId(id)
    setActiveTab('build')
  }

  const handleDeleteWorkout = (id: string) => {
    if (!confirm('Delete this workout?')) return
    setSavedWorkouts((prev) => prev.filter((w) => w.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setBuilderName(DEFAULTS.builderName)
      setBuilderSegments(DEFAULTS.builderSegments)
    }
  }

  const handleShareWorkout = async (id: string) => {
    const w = savedWorkouts.find((sw) => sw.id === id)
    if (!w) return
    const url = buildWorkoutShareUrl({ name: w.name, segments: w.segments })
    const ok = await copyToClipboard(url)
    const status = ok ? 'copied' : 'error'
    setShareStatuses((prev) => ({ ...prev, [id]: status }))
    setTimeout(() => setShareStatuses((prev) => { const n = { ...prev }; delete n[id]; return n }), 2000)
  }

  // Builder save
  const handleBuilderSave = (name: string, segments: EditableSegment[]) => {
    if (editingId) {
      setSavedWorkouts((prev) => prev.map((w) => w.id === editingId ? { ...w, name, segments } : w))
    } else {
      setSavedWorkouts((prev) => [...prev, { id: generateId(), name, segments }])
    }
    setEditingId(null)
    setBuilderName(DEFAULTS.builderName)
    setBuilderSegments(DEFAULTS.builderSegments)
    setActiveTab('library')
  }

  const handleNewWorkout = () => {
    setEditingId(null)
    setBuilderName(DEFAULTS.builderName)
    setBuilderSegments(DEFAULTS.builderSegments)
  }

  // Shared workout received via link
  const handleSaveSharedWorkout = () => {
    if (!sharedWorkout) return
    setSavedWorkouts((prev) => [...prev, { id: generateId(), name: sharedWorkout.name, segments: sharedWorkout.segments }])
    setSharedWorkout(null)
    setActiveTab('library')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ergometry</h1>
        <p>Predict splits for any erg workout.</p>
      </header>

      {sharedWorkout && (
        <div className="shared-banner">
          <span>
            <strong>Shared workout:</strong> {sharedWorkout.name}
          </span>
          <div className="shared-banner-actions">
            <button className="shared-save-btn" onClick={handleSaveSharedWorkout}>
              Save to library
            </button>
            <button className="shared-dismiss-btn" onClick={() => setSharedWorkout(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <nav className="tab-bar" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`tab-btn${activeTab === 'profile' ? ' active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'library'}
          className={`tab-btn${activeTab === 'library' ? ' active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'build'}
          className={`tab-btn${activeTab === 'build' ? ' active' : ''}`}
          onClick={() => setActiveTab('build')}
        >
          Build
        </button>
      </nav>

      {activeTab === 'profile' && (
        <section className="panel">
          <h2>Your profile</h2>
          <div className="twok-inputs">
            <label className="field">
              <span>2K time</span>
              <input
                type="text"
                value={twoKInput}
                onChange={(e) => onTwoKChange(e.target.value)}
                placeholder="m:ss"
              />
            </label>
            <label className="field">
              <span>2K split /500m</span>
              <input
                type="text"
                value={splitInput}
                onChange={(e) => onSplitChange(e.target.value)}
                placeholder="m:ss.t"
              />
            </label>
          </div>

          <fieldset className="tier-group">
            <legend>Tier</legend>
            {ALL_TIERS.map((t) => (
              <label key={t} className={`tier-option ${tier === t ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="tier"
                  value={t}
                  checked={tier === t}
                  onChange={() => setTier(t)}
                />
                <span className="tier-label">
                  {t === 'custom' ? 'Custom' : TIER_DEFS[t].label}
                </span>
                {t !== 'custom' && <span className="tier-desc">{TIER_DEFS[t].description}</span>}
                {t === 'custom' && (
                  <span className="tier-desc">Personalize with a ratio or an actual 6K score.</span>
                )}
              </label>
            ))}
          </fieldset>

          {tier === 'custom' && (
            <div className="custom-controls">
              <div className="mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={customMode === 'slider'}
                  className={customMode === 'slider' ? 'active' : ''}
                  onClick={() => setCustomMode('slider')}
                >
                  Ratio slider
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={customMode === 'scores'}
                  className={customMode === 'scores' ? 'active' : ''}
                  onClick={() => setCustomMode('scores')}
                >
                  From 6K score
                </button>
              </div>

              {customMode === 'slider' ? (
                <label className="field">
                  <span>
                    Fitness profile: <code>{customRatio.toFixed(2)}</code>
                  </span>
                  <div className="slider-with-marks">
                    <input
                      type="range"
                      min="0.55"
                      max="0.92"
                      step="0.01"
                      value={customRatio}
                      onChange={(e) => setCustomRatio(Number(e.target.value))}
                    />
                    <div className="slider-marks" aria-hidden="true">
                      {(['recreational', 'competitive', 'world-class'] as const).map((t) => {
                        const r = TIER_DEFS[t].cpRatio
                        const pct = ((r - 0.55) / (0.92 - 0.55)) * 100
                        return (
                          <div
                            key={t}
                            className="slider-mark"
                            style={{ left: `${pct}%` }}
                            title={`${TIER_DEFS[t].label}: ${r.toFixed(2)}`}
                          >
                            <span className="mark-tick" />
                            <span className="mark-label">
                              {TIER_DEFS[t].label}
                              <br />
                              <code>{r.toFixed(2)}</code>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <span className="hint">
                    Slide toward "World-class" for a more aerobic profile (less fade
                    on long pieces), toward "Recreational" for more.
                  </span>
                </label>
              ) : (
                <div className="scores-inputs">
                  <div className="twok-inputs">
                    <label className="field">
                      <span>6K time</span>
                      <input
                        type="text"
                        value={sixKInput}
                        onChange={(e) => onSixKChange(e.target.value)}
                        placeholder="e.g. 22:30"
                      />
                    </label>
                    <label className="field">
                      <span>6K split /500m</span>
                      <input
                        type="text"
                        value={sixKSplitInput}
                        onChange={(e) => onSixKSplitChange(e.target.value)}
                        placeholder="m:ss.t"
                      />
                    </label>
                  </div>
                  {sixKInvalid ? (
                    <p className="error">
                      6K split must be slower than your 2K split (6K time &gt;{' '}
                      {formatTime(3 * twoKSeconds)}).
                    </p>
                  ) : (
                    <p className="hint">Your fitness profile is fit from these two tests.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {!profile && <p className="error">Enter a plausible 2K time (5:00–15:00).</p>}
          {fit && <TierInsight fit={fit} sixKProvided={profile?.sixKSeconds !== undefined} />}

          <button className="share-button" type="button" onClick={handleProfileShare}>
            {profileShareStatus === 'copied' ? 'link copied ✓' : profileShareStatus === 'error' ? 'copy failed' : 'Share profile'}
          </button>
        </section>
      )}

      {activeTab === 'library' && (
        <section className="panel">
          <h2>Predicted splits</h2>
          <WorkoutList
            fit={fit}
            savedWorkouts={savedWorkouts}
            shareStatuses={shareStatuses}
            onEditWorkout={handleEditWorkout}
            onDeleteWorkout={handleDeleteWorkout}
            onShareWorkout={handleShareWorkout}
          />
        </section>
      )}

      {activeTab === 'build' && (
        <section className="panel">
          <div className="build-header">
            <h2>{editingId ? 'Edit workout' : 'Build your own'}</h2>
            {editingId && (
              <button className="link-button" type="button" onClick={handleNewWorkout}>
                + New workout
              </button>
            )}
          </div>
          <WorkoutBuilder
            fit={fit}
            name={builderName}
            segments={builderSegments}
            onChange={(patch) => {
              if (patch.name !== undefined) setBuilderName(patch.name)
              if (patch.segments !== undefined) setBuilderSegments(patch.segments)
            }}
            onSave={handleBuilderSave}
            saveLabel={editingId ? 'Update workout' : 'Save to library'}
          />
        </section>
      )}

      <footer className="app-footer">
        <p>Predictions are estimates — your own pace is the ground truth.</p>
      </footer>
    </div>
  )
}

export default App
