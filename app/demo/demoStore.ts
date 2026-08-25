// Persistie voor de publieke demo — UITSLUITEND localStorage, nooit
// Supabase of enige andere backend. Elke bezoeker krijgt zo z'n eigen
// geïsoleerde sandbox: wijzigingen zijn nooit zichtbaar voor iemand
// anders en raken nooit echte Studio Yoko-data.
import { buildSeedTasks, buildSeedTodos, type DemoTask, type DemoTodo } from './demoData'

const KEY = 'yoko-demo-state-v1'

export type DemoState = {
  tasks: DemoTask[]
  todos: DemoTodo[]
  seededAt: string
}

function freshState(): DemoState {
  return { tasks: buildSeedTasks(), todos: buildSeedTodos(), seededAt: new Date().toISOString() }
}

export function loadDemoState(): DemoState {
  if (typeof window === 'undefined') return freshState()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DemoState
  } catch {}
  const s = freshState()
  saveDemoState(s)
  return s
}

export function saveDemoState(state: DemoState): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
}

export function resetDemoState(): DemoState {
  const s = freshState()
  saveDemoState(s)
  return s
}
