import { isOnDemoRoute } from './demoFixtures'

export type ActivityEntry = {
  id:     string
  ts:     string
  action: string
  target: string
  detail?: string
}

const KEY      = 'yoko-activity'
// /demo krijgt een eigen key — anders zou een demo-sessie in dezelfde
// browser als een échte ingelogde sessie hun activiteitenlogs mengen.
const DEMO_KEY = 'yoko-demo-activity'
const MAX = 200

function activeKey(): string {
  return isOnDemoRoute() ? DEMO_KEY : KEY
}

export function logActivity(action: string, target: string, detail?: string): void {
  if (typeof window === 'undefined') return
  try {
    const all = loadActivity()
    all.unshift({ id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), action, target, detail })
    localStorage.setItem(activeKey(), JSON.stringify(all.slice(0, MAX)))
  } catch { /* ignore */ }
}

export function loadActivity(): ActivityEntry[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(activeKey()); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function clearActivity(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(activeKey())
}
