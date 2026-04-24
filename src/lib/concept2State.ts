import { useCallback, useEffect, useState } from 'react'
import { buildAuthUrl, generateState } from './concept2/oauth'
import {
  clearToken,
  loadToken,
  saveOAuthState,
  saveReturnPath,
} from './concept2/tokens'
import { getMe, postResult } from './concept2/client'
import { buildUploadPayload, normalizeWeightClass } from './concept2/upload'
import type { Concept2User } from './concept2/types'
import { isConcept2Configured } from './concept2/config'
import type { Workout } from '../model/workouts'
import type { PM5SplitRecord, PM5StrokeRecord, PM5Telemetry } from './pm5'

export type Concept2Status =
  | 'unconfigured'   // env vars missing
  | 'disconnected'   // no token
  | 'connecting'     // redirecting to authorize
  | 'connected'      // token in hand, user fetched (or pending)
  | 'uploading'      // POSTing a result
  | 'upload-done'
  | 'error'

export interface Concept2State {
  status: Concept2Status
  error: string | null
  user: Concept2User | null
  connect: () => void
  disconnect: () => void
  upload: (args: {
    workout: Workout
    telemetry: PM5Telemetry
    strokes?: PM5StrokeRecord[]
    splits?: PM5SplitRecord[]
  }) => Promise<void>
}

export function useConcept2(): Concept2State {
  const [status, setStatus] = useState<Concept2Status>(() => {
    if (!isConcept2Configured()) return 'unconfigured'
    return loadToken() ? 'connected' : 'disconnected'
  })
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<Concept2User | null>(null)

  // Fetch /users/me once we have a token. Tolerate failures — the connection
  // still works for uploads even if the profile fetch errored.
  useEffect(() => {
    if (status !== 'connected' || user) return
    let cancelled = false
    getMe()
      .then((u) => { if (!cancelled) setUser(u) })
      .catch((e) => {
        if (cancelled) return
        // If the token is dead, flip back to disconnected; otherwise swallow.
        if (!loadToken()) {
          setStatus('disconnected')
          setError((e as Error).message)
        }
      })
    return () => { cancelled = true }
  }, [status, user])

  const connect = useCallback(() => {
    if (!isConcept2Configured()) {
      setStatus('unconfigured')
      setError('Concept2 client credentials missing — set VITE_CONCEPT2_* in .env.local')
      return
    }
    const state = generateState()
    saveOAuthState(state)
    saveReturnPath(location.pathname + location.search)
    setStatus('connecting')
    location.assign(buildAuthUrl(state))
  }, [])

  const disconnect = useCallback(() => {
    clearToken()
    setUser(null)
    setError(null)
    setStatus('disconnected')
  }, [])

  const upload = useCallback(async (args: {
    workout: Workout
    telemetry: PM5Telemetry
    strokes?: PM5StrokeRecord[]
    splits?: PM5SplitRecord[]
  }) => {
    setStatus('uploading')
    setError(null)
    try {
      // Concept2's /users/me doesn't reliably include weight_class, so we
      // can't always look it up. Default to heavyweight (~95% of rowers) when
      // unavailable. A future enhancement can expose a one-tap override for
      // lightweights.
      const wc = normalizeWeightClass(user?.weight_class) ?? 'H'
      const payload = buildUploadPayload({ ...args, weightClass: wc })
      await postResult(payload)
      setStatus('upload-done')
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    }
  }, [user])

  return { status, error, user, connect, disconnect, upload }
}
