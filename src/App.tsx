import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitProfile, type AthleteProfile } from './model/pacing'
import { TIER_DEFS, type Tier } from './model/tiers'
import { parseTime, formatTime, formatSplit } from './lib/time'
import { TierInsight } from './components/TierInsight'
import { WorkoutList } from './components/WorkoutList'
import { type EditableInterval, workoutToEditableIntervals } from './components/WorkoutBuilder'
import { WorkoutView } from './components/WorkoutView'
import { usePM5 } from './lib/pm5State'
import { ALL_PRESETS } from './model/presets'
import {
  loadState,
  saveState,
  readWorkoutIntervals,
  type PersistedState,
  type SavedWorkout,
} from './lib/storage'
import { buildShareUrl, buildWorkoutShareUrl, readHashState, readHashWorkout } from './lib/urlState'

const ALL_TIERS: Tier[] = ['world-class', 'competitive', 'recreational', 'custom']

type CustomMode = 'slider' | 'scores'
type Tab = 'profile' | 'workouts'
type ViewState =
  | { kind: 'create'; name?: string; intervals?: EditableInterval[] }
  | { kind: 'edit'; id: string }
  | { kind: 'view-saved'; id: string }
  | { kind: 'view-preset'; presetId: string }
  | null

const DEFAULTS = {
  twoKInput: '7:00',
  tier: 'competitive' as Tier,
  customMode: 'scores' as CustomMode,
  customRatio: 0.7,
  sixKInput: '',
  savedWorkouts: [] as SavedWorkout[],
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// True for first-time / incognito visitors — also true after the default-only
// state has been auto-persisted on mount, so refreshes don't promote a user
// who never touched anything to the Workouts tab.
function isFirstTimeLike(stored: Partial<PersistedState> | null): boolean {
  if (!stored) return true
  const customized =
    (stored.twoKInput !== undefined && stored.twoKInput !== DEFAULTS.twoKInput) ||
    (stored.tier !== undefined && stored.tier !== DEFAULTS.tier) ||
    (stored.customMode !== undefined && stored.customMode !== DEFAULTS.customMode) ||
    (stored.customRatio !== undefined && stored.customRatio !== DEFAULTS.customRatio) ||
    (stored.sixKInput !== undefined && stored.sixKInput !== DEFAULTS.sixKInput) ||
    (Array.isArray(stored.savedWorkouts) && stored.savedWorkouts.length > 0)
  return !customized
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
  const savedWorkouts = Array.isArray(src?.savedWorkouts)
    ? (src!.savedWorkouts as SavedWorkout[]).map((sw) => ({
        id: sw.id,
        name: sw.name,
        intervals: readWorkoutIntervals(sw),
      }))
    : DEFAULTS.savedWorkouts
  return {
    twoKInput: (src?.twoKInput as string) ?? DEFAULTS.twoKInput,
    tier: (src?.tier as Tier) ?? DEFAULTS.tier,
    customMode: (src?.customMode as CustomMode) ?? DEFAULTS.customMode,
    customRatio: (src?.customRatio as number) ?? DEFAULTS.customRatio,
    sixKInput: (src?.sixKInput as string) ?? DEFAULTS.sixKInput,
    savedWorkouts,
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

  // Workouts state
  const [savedWorkouts, setSavedWorkouts] = useState<SavedWorkout[]>(init.savedWorkouts)
  const [shareStatuses, setShareStatuses] = useState<Record<string, 'copied' | 'error'>>({})

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    isFirstTimeLike(loadState()) ? 'profile' : 'workouts',
  )
  const [view, setViewRaw] = useState<ViewState>(null)
  const viewKeyRef = useRef<string | null>(null)
  const popGuardRef = useRef(false)
  const pm5 = usePM5()

  // setView wraps the raw setter with history-stack management. Only the
  // first transition from null→view pushes a history entry; subsequent mode
  // changes (e.g. view-saved → edit) reuse the same entry. Closing the view
  // pops the entry so the URL/history match the visible state, and a
  // hardware back-button (popstate) closes the view without double-popping.
  const setView = useCallback((next: ViewState) => {
    const wasOpen = viewKeyRef.current !== null
    if (next !== null && !wasOpen) {
      const key = `v${Date.now()}-${Math.random().toString(36).slice(2)}`
      viewKeyRef.current = key
      history.pushState({ viewKey: key }, '')
      // Chrome on localhost fires a synchronous popstate on pushState. Suppress
      // it for one frame so the listener doesn't immediately close us.
      popGuardRef.current = true
      requestAnimationFrame(() => { popGuardRef.current = false })
    } else if (next === null && wasOpen) {
      if (history.state?.viewKey === viewKeyRef.current) {
        history.back()
      }
      viewKeyRef.current = null
    }
    setViewRaw(next)
  }, [])

  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      if (popGuardRef.current) return
      if (!e.state?.viewKey) {
        viewKeyRef.current = null
        setViewRaw(null)
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])
  const [profileShareStatus, setProfileShareStatus] = useState<'' | 'copied' | 'error'>('')
  const [sharedWorkout, setSharedWorkout] = useState<{ name: string; intervals: EditableInterval[] } | null>(() => {
    const w = readHashWorkout()
    return w ? { name: w.name, intervals: w.intervals as EditableInterval[] } : null
  })
  const [helpOpen, setHelpOpen] = useState(() => isFirstTimeLike(loadState()))

  // Clear workout hash from URL on load (profile hashes are cleared on share)
  useEffect(() => {
    if (sharedWorkout) {
      history.replaceState(null, '', location.pathname)
    }
  }, [])

  // Persist state
  useEffect(() => {
    saveState({ twoKInput, tier, customMode, customRatio, sixKInput, savedWorkouts })
  }, [twoKInput, tier, customMode, customRatio, sixKInput, savedWorkouts])

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

  // Workout list actions
  const handleAddWorkout = () => {
    setView({ kind: 'create' })
  }

  const handleOpenSavedWorkout = (id: string) => {
    setView({ kind: 'view-saved', id })
  }

  const handleOpenPreset = (id: string) => {
    setView({ kind: 'view-preset', presetId: id })
  }

  const handleDeleteWorkout = (id: string) => {
    setSavedWorkouts((prev) => prev.filter((w) => w.id !== id))
    setView(null)
  }

  const handleMoveWorkoutToEdge = (id: string, edge: 'top' | 'bottom') => {
    setSavedWorkouts((prev) => {
      const idx = prev.findIndex((w) => w.id === id)
      if (idx < 0) return prev
      const item = prev[idx]
      const without = prev.filter((_, i) => i !== idx)
      return edge === 'top' ? [item, ...without] : [...without, item]
    })
  }

  const handleReorderWorkouts = (activeId: string, overId: string) => {
    setSavedWorkouts((prev) => {
      const from = prev.findIndex((w) => w.id === activeId)
      const to = prev.findIndex((w) => w.id === overId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = prev.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const handleShareWorkout = async (id: string) => {
    const w = savedWorkouts.find((sw) => sw.id === id)
    if (!w) return
    const url = buildWorkoutShareUrl({ name: w.name, intervals: readWorkoutIntervals(w) })
    const ok = await copyToClipboard(url)
    const status = ok ? 'copied' : 'error'
    setShareStatuses((prev) => ({ ...prev, [id]: status }))
    setTimeout(() => setShareStatuses((prev) => { const n = { ...prev }; delete n[id]; return n }), 2000)
  }

  // Builder save — rest on the last interval is meaningless (nothing follows)
  // so drop it before persisting. The card renderer re-coalesces that trailing
  // bare rep with the preceding group so "4 × 10' w/ 2'r" still displays intact.
  const handleBuilderSave = (name: string, intervals: EditableInterval[]) => {
    const normalized = intervals.length > 0
      ? intervals.map((iv, idx) =>
          idx === intervals.length - 1 && iv.restValue !== ''
            ? { ...iv, restValue: '' }
            : iv,
        )
      : intervals
    if (view?.kind === 'edit') {
      const id = view.id
      setSavedWorkouts((prev) => prev.map((w) => w.id === id ? { ...w, name, intervals: normalized } : w))
    } else {
      setSavedWorkouts((prev) => [{ id: generateId(), name, intervals: normalized }, ...prev])
    }
    setView(null)
  }

  // Shared workout received via link
  const handleSaveSharedWorkout = () => {
    if (!sharedWorkout) return
    setSavedWorkouts((prev) => [{ id: generateId(), name: sharedWorkout.name, intervals: sharedWorkout.intervals }, ...prev])
    setSharedWorkout(null)
    setActiveTab('workouts')
  }

  const renderView = () => {
    if (!view) return null
    if (view.kind === 'edit' || view.kind === 'view-saved') {
      const w = savedWorkouts.find((sw) => sw.id === view.id)
      if (!w) return null
      const id = view.id
      const kind = view.kind
      return (
        <WorkoutView
          key={`saved-${id}`}
          mode={kind}
          fit={fit}
          pm5={pm5}
          initialName={w.name}
          initialIntervals={readWorkoutIntervals(w) as EditableInterval[]}
          onSave={handleBuilderSave}
          onDelete={() => handleDeleteWorkout(id)}
          onEdit={() => setView({ kind: 'edit', id })}
          onClose={() => setView(null)}
        />
      )
    }
    if (view.kind === 'view-preset') {
      const preset = ALL_PRESETS.find((p) => p.id === view.presetId)
      if (!preset) return null
      return (
        <WorkoutView
          key={`preset-${view.presetId}`}
          mode="view-preset"
          fit={fit}
          pm5={pm5}
          initialName={preset.name}
          initialIntervals={workoutToEditableIntervals(preset)}
          onClose={() => setView(null)}
          onCopy={() =>
            setView({
              kind: 'create',
              name: `Copy of ${preset.name}`,
              intervals: workoutToEditableIntervals(preset),
            })
          }
        />
      )
    }
    return (
      <WorkoutView
        key="create"
        mode="create"
        fit={fit}
        pm5={pm5}
        initialName={view.name}
        initialIntervals={view.intervals}
        onSave={handleBuilderSave}
        onClose={() => setView(null)}
      />
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ergometry</h1>
        <p>Predict splits for any erg workout.</p>
      </header>

      {view ? renderView() : (<>
      <details
        className="how-it-works"
        open={helpOpen}
        onToggle={(e) => setHelpOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>How it works</summary>
        <ol>
          <li>
            <strong>Profile</strong> — enter your 2K and pick a tier (or customize from a 6K).
          </li>
          <li>
            <strong>Workouts</strong> — see predicted splits for presets, or add your own. Tap a saved card to edit it.
          </li>
        </ol>
        <p className="hint">
          Predictions use a critical-power model tuned from your profile. Your data stays in this browser.
        </p>
      </details>

      {sharedWorkout && (
        <div className="shared-banner">
          <span>
            <strong>Shared workout:</strong> {sharedWorkout.name}
          </span>
          <div className="shared-banner-actions">
            <button className="shared-save-btn" onClick={handleSaveSharedWorkout}>
              Save workout
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
          aria-selected={activeTab === 'workouts'}
          className={`tab-btn${activeTab === 'workouts' ? ' active' : ''}`}
          onClick={() => setActiveTab('workouts')}
        >
          Workouts
        </button>
      </nav>

      {activeTab === 'profile' && (
        <section className="panel">
          <h2>Your profile</h2>
          <p className="panel-intro">
            Your 2K and tier anchor every prediction on the other tabs. The tier sets how much your pace fades on longer pieces — pick <em>Custom</em> to dial it in yourself or from an actual 6K.
          </p>
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

      {activeTab === 'workouts' && (
        <section className="panel">
          <h2>Predicted splits</h2>
          <p className="panel-intro">
            Target splits for preset workouts and anything you've saved. Tap <em>+ Add workout</em> to build your own, or tap a saved card to edit it.
          </p>
          <WorkoutList
            fit={fit}
            savedWorkouts={savedWorkouts}
            shareStatuses={shareStatuses}
            onAddWorkout={handleAddWorkout}
            onOpenSavedWorkout={handleOpenSavedWorkout}
            onOpenPreset={handleOpenPreset}
            onShareWorkout={handleShareWorkout}
            onReorderWorkouts={handleReorderWorkouts}
            onMoveWorkoutToEdge={handleMoveWorkoutToEdge}
          />
        </section>
      )}
      </>)}

      <footer className="app-footer">
        <p>Predictions are estimates — your own pace is the ground truth.</p>
      </footer>
    </div>
  )
}

export default App
