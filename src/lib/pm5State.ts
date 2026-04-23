import { useCallback, useState } from 'react'
import { connectPM5, sendWorkout, type PM5Connection } from './pm5'
import type { Workout } from '../model/workouts'

export type PM5Status = 'idle' | 'connecting' | 'ready' | 'uploading' | 'done' | 'error'

export interface PM5State {
  status: PM5Status
  error: string | null
  deviceName: string | null
  hasUploaded: boolean
  conn: PM5Connection | null
  connect: () => Promise<void>
  disconnect: () => void
  send: (workout: Workout, perIntervalPaceSeconds?: number[]) => Promise<void>
}

// Hoisted to App so the GATT session survives navigation between the workout
// list and an open workout view. Calling it inside a child that unmounts on
// navigation would tear down the connection on every back-button press.
export function usePM5(): PM5State {
  const [status, setStatus] = useState<PM5Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [hasUploaded, setHasUploaded] = useState(false)
  const [conn, setConn] = useState<PM5Connection | null>(null)

  const connect = useCallback(async () => {
    if (!('bluetooth' in navigator)) {
      setError('Web Bluetooth not supported in this browser')
      setStatus('error')
      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const c = await connectPM5()
      setConn(c)
      // Concept2 advertises devices as "PM5 <serial> <Row|Ski|Bike>". The
      // trailing erg-type tag is redundant in this app and causes the name to
      // wrap onto a second line on narrow screens — strip it.
      const raw = c.device.name ?? 'PM5'
      setDeviceName(raw.replace(/\s+(Row|Ski|Bike)$/i, ''))
      setStatus('ready')
      c.device.addEventListener('gattserverdisconnected', () => {
        setConn(null)
        setStatus('idle')
        setDeviceName(null)
        setHasUploaded(false)
      })
    } catch (e) {
      const err = e as Error
      if (err.name === 'NotFoundError') {
        setStatus('idle')
      } else {
        setError(err.message)
        setStatus('error')
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    conn?.device.gatt?.disconnect()
    setConn(null)
    setStatus('idle')
    setDeviceName(null)
    setError(null)
    setHasUploaded(false)
  }, [conn])

  const send = useCallback(async (
    workout: Workout,
    perIntervalPaceSeconds?: number[],
  ) => {
    if (!conn) return
    setStatus('uploading')
    setError(null)
    try {
      await sendWorkout(conn, workout, { perIntervalPaceSeconds })
      setStatus('done')
      setHasUploaded(true)
      setTimeout(() => setStatus(s => s === 'done' ? 'ready' : s), 2000)
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    }
  }, [conn])

  return { status, error, deviceName, hasUploaded, conn, connect, disconnect, send }
}
