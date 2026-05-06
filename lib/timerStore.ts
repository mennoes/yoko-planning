export type ActiveTimer = { projectId: string; projectName: string; startTs: string }
export type TimeEntry   = { id: string; projectId: string; projectName: string; start: string; end: string; minutes: number }

const ACTIVE_KEY  = 'yoko-timer-active'
const ENTRIES_KEY = 'yoko-time-entries'
const EVENT_NAME  = 'yoko-timer-update'

export function getActiveTimer(): ActiveTimer | null {
  if (typeof window === 'undefined') return null
  try { const s = localStorage.getItem(ACTIVE_KEY); return s ? JSON.parse(s) : null } catch { return null }
}

async function logTimerActivity(action: string, target: string, detail?: string) {
  // Avoid circular import — load lazily
  try { const { logActivity } = await import('./activityLog'); logActivity(action, target, detail) } catch { /* ignore */ }
}

export function startTimer(projectId: string, projectName: string): void {
  // Stop any existing timer first
  const active = getActiveTimer()
  if (active) stopTimer()
  const t: ActiveTimer = { projectId, projectName, startTs: new Date().toISOString() }
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(t))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
  void logTimerActivity('Timer gestart', projectName)
}

export function stopTimer(): TimeEntry | null {
  const active = getActiveTimer()
  if (!active) return null
  const end     = new Date().toISOString()
  const minutes = Math.max(1, Math.round((Date.now() - new Date(active.startTs).getTime()) / 60000))
  const entry: TimeEntry = {
    id: Date.now().toString(),
    projectId: active.projectId, projectName: active.projectName,
    start: active.startTs, end, minutes,
  }
  const all = loadEntries()
  all.push(entry)
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(all))
  localStorage.removeItem(ACTIVE_KEY)
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
  void logTimerActivity('Timer gestopt', active.projectName, `${minutes} min geregistreerd`)
  return entry
}

export function loadEntries(): TimeEntry[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(ENTRIES_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function entriesForProject(projectId: string): TimeEntry[] {
  return loadEntries().filter(e => e.projectId === projectId)
}

export function totalMinutesForProject(projectId: string): number {
  return entriesForProject(projectId).reduce((s, e) => s + e.minutes, 0)
}

export function deleteEntry(id: string): void {
  const all = loadEntries().filter(e => e.id !== id)
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function onTimerUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT_NAME, handler)
  // Also listen for storage events from other tabs
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    window.removeEventListener('storage', handler)
  }
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}u` : `${h}u ${m}m`
}
