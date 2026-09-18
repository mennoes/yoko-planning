'use client'

import type { Session } from '@supabase/supabase-js'

const DEVICE_KEY = 'yoko-login-device-v1'

function deviceId(): string {
  let id = ''
  try { id = window.localStorage.getItem(DEVICE_KEY) ?? '' } catch {}
  if (/^[0-9a-f-]{36}$/i.test(id)) return id
  id = crypto.randomUUID()
  try { window.localStorage.setItem(DEVICE_KEY, id) } catch {}
  return id
}

let lastSessionToken = ''

/**
 * Register the current browser after a successful Supabase login. The server
 * decides whether it is new and sends the alert; login must never be blocked
 * when the optional alert service is unavailable.
 */
export async function registerLoginDevice(session: Session): Promise<void> {
  if (typeof window === 'undefined' || !session.access_token) return
  if (lastSessionToken === session.access_token) return
  lastSessionToken = session.access_token
  try {
    await fetch('/api/auth/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ deviceId: deviceId() }),
      keepalive: true,
    })
  } catch {
    // Security notifications are best-effort and may never break login.
  }
}
