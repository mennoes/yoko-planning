'use client'

// Publieke, interactieve demo van Yoko Planner — bedoeld om te delen
// (bv. op LinkedIn). Volledig losstaand van de echte app:
//   - GEEN Supabase-calls, GEEN Google-sync, GEEN echte klant- of
//     teamdata — alles hier komt uit demoData.ts (verzonnen).
//   - Persistie is puur lokaal (demoStore.ts → localStorage), dus elke
//     bezoeker krijgt zijn eigen sandbox die nooit iemand anders raakt.
import { useEffect, useMemo, useState } from 'react'
import { DEMO_MEMBERS, type DemoStatus, type DemoTask } from './demoData'
import { loadDemoState, saveDemoState, resetDemoState, type DemoState } from './demoStore'

const STATUS_ORDER: DemoStatus[] = ['Not started', 'Working on...', 'Done']
const STATUS_BG: Record<DemoStatus, string> = {
  'Not started':    'rgba(154,149,144,0.18)',
  'Working on...':  'rgba(255,123,36,0.18)',
  'Done':           'rgba(0,200,117,0.18)',
}
const STATUS_FG: Record<DemoStatus, string> = {
  'Not started':   '#9A9590',
  'Working on...': '#ff7b24',
  'Done':          '#037f4c',
}

const NL_MON = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
function fmt(d: Date): string { return `${d.getDate()} ${NL_MON[d.getMonth()]}` }
function addDays(base: Date, n: number): Date {
  const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d
}

// Venster: 7 dagen terug t/m 27 dagen vooruit t.o.v. 'vandaag' (35 dagen).
const WIN_BACK  = 7
const WIN_FWD   = 27
const WIN_TOTAL = WIN_BACK + WIN_FWD + 1

function barHeight(task: DemoTask): number {
  const days = Math.max(1, task.endOffset - task.startOffset + 1)
  const perDay = task.estHours / days
  const dayH = 0.1 + 0.9 * Math.sqrt(Math.min(1, perDay / 8))
  const totalH = 0.1 + 0.9 * Math.min(1, task.estHours / 40)
  const ratio = Math.max(dayH, totalH)
  return Math.round(26 + ratio * 42)
}

function nextStatus(s: DemoStatus): DemoStatus {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % STATUS_ORDER.length]
}

export default function DemoPage() {
  const [state, setState]       = useState<DemoState | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [newTodo, setNewTodo]   = useState('')

  useEffect(() => { setState(loadDemoState()) }, [])

  // 'Vandaag' schuift mee op basis van verstreken tijd sinds de eerste
  // keer dat deze browser de demo seedde — zo blijft de tijdlijn kloppen
  // ook als iemand na een paar dagen terugkomt, zonder de taken zelf te
  // verplaatsen.
  const todayOffset = useMemo(() => {
    if (!state) return 0
    const ms = Date.now() - new Date(state.seededAt).getTime()
    return Math.floor(ms / 86400000)
  }, [state])

  const weekLabels = useMemo(() => {
    const out: { label: string; leftPct: number }[] = []
    for (let w = -Math.floor(WIN_BACK / 7); w * 7 <= WIN_FWD; w++) {
      const offset = w * 7
      if (offset < -WIN_BACK) continue
      const d = addDays(new Date(), offset)
      out.push({ label: fmt(d), leftPct: ((offset + WIN_BACK) / WIN_TOTAL) * 100 })
    }
    return out
  }, [])

  if (!state) return <main style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Laden…</main>

  const update = (next: DemoState) => { setState(next); saveDemoState(next) }
  const updateTask = (id: string, patch: Partial<DemoTask>) => {
    update({ ...state, tasks: state.tasks.map(t => t.id === id ? { ...t, ...patch } : t) })
  }
  const toggleTodo = (id: string) => {
    update({ ...state, todos: state.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) })
  }
  const addTodo = (text: string) => {
    const t = text.trim()
    if (!t) return
    update({ ...state, todos: [...state.todos, { id: `d${Date.now()}`, text: t, done: false }] })
    setNewTodo('')
  }
  const doReset = () => { setSelected(null); update(resetDemoState()) }

  const clients = [...new Set(state.tasks.map(t => t.client))]
  const selectedTask = state.tasks.find(t => t.id === selected) ?? null
  const vandaagLeftPct = (WIN_BACK / WIN_TOTAL) * 100

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px 100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--accent)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Live demo · geen echte data
          </span>
        </div>
        <button onClick={doReset}
          style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
          ↺ Reset demo
        </button>
      </div>
      <h1 style={{ fontSize: 34, fontWeight: 700, margin: '2px 0 8px', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        Yoko Planner
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 28px', maxWidth: 620, lineHeight: 1.5 }}>
        Klik op een balk om de uren of status te wijzigen — je ziet de hoogte en de teamdruk direct meebewegen.
        Alles hieronder is verzonnen en wordt alleen lokaal in jouw browser bewaard.
      </p>

      {/* ── Tijdlijn ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ position: 'relative', height: 22, marginBottom: 6 }}>
          {weekLabels.map((w, i) => (
            <span key={i} style={{ position: 'absolute', left: `${w.leftPct}%`, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{w.label}</span>
          ))}
        </div>
        <div style={{ position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '14px 0', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${vandaagLeftPct}%`, width: 2, background: 'var(--accent)', opacity: 0.6 }} />
          {clients.map(client => {
            const tasks = state.tasks.filter(t => t.client === client)
            const color = tasks[0]?.color ?? 'var(--accent)'
            return (
              <div key={client} style={{ padding: '6px 20px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{client}</span>
                </div>
                <div style={{ position: 'relative', height: 78 }}>
                  {tasks.map(t => {
                    // Task-offsets zijn t.o.v. het seed-moment; het venster
                    // verschuift mee met todayOffset zodat 'vandaag' altijd
                    // op de vandaag-lijn blijft staan, ook bij een bezoek
                    // een paar dagen na de eerste keer.
                    const windowStart = todayOffset - WIN_BACK
                    const windowEnd   = todayOffset + WIN_FWD
                    const clampedStart = Math.max(t.startOffset, windowStart)
                    const clampedEnd   = Math.min(t.endOffset, windowEnd)
                    if (clampedEnd < clampedStart) return null
                    const leftPct  = ((clampedStart - windowStart) / WIN_TOTAL) * 100
                    const widthPct = ((clampedEnd - clampedStart + 1) / WIN_TOTAL) * 100
                    const h = barHeight(t)
                    const isSel = selected === t.id
                    const isDone = t.status === 'Done'
                    return (
                      <button key={t.id}
                        onClick={() => setSelected(isSel ? null : t.id)}
                        title={`${t.name} · ${t.estHours}u`}
                        style={{
                          position: 'absolute', left: `${leftPct}%`, width: `${Math.max(widthPct, 3)}%`,
                          top: 0, height: h, minWidth: 26,
                          background: t.color + (isDone ? '55' : '33'),
                          border: `1.5px solid ${isSel ? t.color : t.color + '80'}`,
                          borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                          padding: '4px 8px', overflow: 'hidden',
                          boxShadow: isSel ? `0 0 0 2px ${t.color}55` : 'none',
                          opacity: isDone ? 0.6 : 1,
                        }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: isDone ? 'line-through' : 'none' }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.estHours}u</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Edit-paneel voor geselecteerde taak ─────────────────────── */}
      {selectedTask && (
        <section style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          background: 'var(--bg-card)', border: `1px solid ${selectedTask.color}55`, borderRadius: 12,
          padding: '12px 18px', marginBottom: 32,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: selectedTask.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 140 }}>{selectedTask.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uren</span>
            <button onClick={() => updateTask(selectedTask.id, { estHours: Math.max(1, selectedTask.estHours - 2) })}
              style={miniBtn}>−</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 28, textAlign: 'center' }}>{selectedTask.estHours}u</span>
            <button onClick={() => updateTask(selectedTask.id, { estHours: selectedTask.estHours + 2 })}
              style={miniBtn}>+</button>
          </div>
          <button onClick={() => updateTask(selectedTask.id, { status: nextStatus(selectedTask.status) })}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
              background: STATUS_BG[selectedTask.status], color: STATUS_FG[selectedTask.status], border: 'none',
            }}>{selectedTask.status} ↻</button>
          <button onClick={() => setSelected(null)} style={{ ...miniBtn, borderRadius: 6, padding: '4px 10px', width: 'auto' }}>Sluiten</button>
        </section>
      )}

      {/* ── Team-werkdruk ────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>Team deze week</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {DEMO_MEMBERS.map(m => {
            const hours = memberWeekHours(m.id, state.tasks, todayOffset)
            const pct = Math.min(1, hours / m.weeklyCapacity)
            const barColor = pct > 0.9 ? '#C9483D' : pct > 0.6 ? 'var(--accent)' : '#6FA181'
            return (
              <div key={m.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', background: m.color + '30', border: `1.5px solid ${m.color}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: m.color,
                  }}>{m.name.charAt(0)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>{hours}/{m.weeklyCapacity}u</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Todo-lijst ───────────────────────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>Jouw taken</h2>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden' }}>
          {state.todos.map((t, i) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              borderBottom: i < state.todos.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              <button onClick={() => toggleTodo(t.id)}
                style={{
                  width: 18, height: 18, borderRadius: 4, border: '2px solid var(--border)',
                  background: t.done ? 'var(--accent)' : 'transparent', flexShrink: 0, padding: 0, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11,
                }}>{t.done ? '✓' : ''}</button>
              <span style={{ fontSize: 13, color: t.done ? 'var(--text-muted)' : 'var(--text-secondary)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
            </div>
          ))}
          <form onSubmit={e => { e.preventDefault(); addTodo(newTodo) }} style={{ padding: '10px 16px', display: 'flex', gap: 8 }}>
            <input value={newTodo} onChange={e => setNewTodo(e.target.value)} placeholder="+ Voeg een taak toe…"
              style={{ flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none' }} />
          </form>
        </div>
      </section>

      <footer style={{ paddingTop: 16, borderTop: '1px solid var(--border-light)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Demo-omgeving van Yoko Planner · verzonnen data, alleen bewaard in jouw browser · niet gedeeld of gesynchroniseerd
      </footer>
    </main>
  )
}

const miniBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 6, border: '1px solid var(--border-light)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}

function memberWeekHours(memberId: string, tasks: DemoTask[], todayOffset: number): number {
  const dow = (new Date().getDay() + 6) % 7 // 0=ma..6=zo
  const weekStart = todayOffset - dow
  const weekEnd   = todayOffset + (6 - dow)
  let total = 0
  for (const t of tasks) {
    if (!t.ownerIds.includes(memberId)) continue
    const days = Math.max(1, t.endOffset - t.startOffset + 1)
    const perOwner = t.estHours / Math.max(1, t.ownerIds.length)
    const perDay = perOwner / days
    const overlapStart = Math.max(t.startOffset, weekStart)
    const overlapEnd   = Math.min(t.endOffset, weekEnd)
    if (overlapEnd < overlapStart) continue
    total += perDay * (overlapEnd - overlapStart + 1)
  }
  return Math.round(total * 10) / 10
}
