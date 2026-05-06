export type ActivityEntry = {
  id:     string
  ts:     string
  action: string
  target: string
  detail?: string
}

const KEY = 'yoko-activity'
const MAX = 200

export function logActivity(action: string, target: string, detail?: string): void {
  if (typeof window === 'undefined') return
  try {
    const all = loadActivity()
    all.unshift({ id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), action, target, detail })
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)))
  } catch { /* ignore */ }
}

export function loadActivity(): ActivityEntry[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function clearActivity(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}
