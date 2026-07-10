'use client'

import { useState, useEffect, useMemo } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { useTeam } from '@/components/TeamContext'
import {
  type BudgetEntry, BUDGET_ALLOWED_MEMBER_IDS,
  loadBudgetEntries, pullBudgetEntries, subscribeRemoteBudget,
  upsertBudgetEntry, deleteBudgetEntry, genBudgetId,
  quarterRange, quarterOf, quarterLabel, currentQuarter,
} from '@/lib/budgetStore'
import {
  type ProjectRevenue,
  loadProjectRevenue, pullProjectRevenue, subscribeRemoteProjectRevenue,
  upsertProjectRevenue,
} from '@/lib/projectRevenueStore'
import { getBoards } from '@/lib/boardsRegistry'
import { loadGroups } from '@/lib/boardStore'
import type { BoardItem } from '@/lib/boards'
import { isVrijTitle } from '@/lib/workloadCategory'
import { IconChart } from '@/components/Icon'

// ─── Project-lijst (Menno/Vincent als owner, over alle boards) ─────────────
type ForecastProject = {
  itemId:   string
  boardId:  string
  boardName: string
  name:     string
  ownerIds: string[]     // subset ∩ {menno, vincent}
  status:   string
  endDate:  string | null  // effectieve einddatum (subitem-rollup), bepaalt kwartaal
}

// Zelfde subitem-rollup als BoardTable's effectiveItem: vroegste/laatste
// actieve-subitem-datum wint van het eigen (mogelijk stale) veld van de
// parent. Nodig zodat de kwartaal-toewijzing hier hetzelfde 'einddatum'
// gebruikt als wat de gebruiker in de planning-borden ziet.
function effectiveEndDateOf(item: BoardItem): string | null {
  const subs = item.subitems
  if (subs && subs.length > 0) {
    const activeSubs = subs.filter(s => s.status !== 'Done')
    const dateSubs   = activeSubs.length > 0 ? activeSubs : subs
    const subEnds    = dateSubs.map(s => s.endDate).filter(Boolean) as string[]
    if (subEnds.length > 0) return [...subEnds].sort().slice(-1)[0]
  }
  return item.endDate ?? item.startDate ?? null
}

function loadForecastProjects(): ForecastProject[] {
  const out: ForecastProject[] = []
  for (const board of getBoards()) {
    const groups = loadGroups(board.id, [])
    for (const g of groups) {
      for (const item of g.items) {
        if ((item.name ?? '').trim() === 'Nieuw item') continue
        // Vrij/vakantie/verlof-items zijn geen factureerbaar werk — horen
        // niet in een omzet-forecast. Google Calendar-meetings evenmin —
        // die zijn er per definitie met tientallen en representeren geen
        // apart te factureren klantproject.
        if (isVrijTitle(item.name)) continue
        if (item.source === 'google') continue
        const owned = (item.ownerIds ?? []).filter(id => BUDGET_ALLOWED_MEMBER_IDS.includes(id))
        if (owned.length === 0) continue
        out.push({
          itemId: `${board.id}__${item.id}`, boardId: board.id, boardName: board.name,
          name: item.name, ownerIds: owned, status: item.status,
          endDate: effectiveEndDateOf(item),
        })
      }
    }
  }
  return out
}

// ─── Geld-formattering ──────────────────────────────────────────────────────
const fmtEuro = (n: number) => new Intl.NumberFormat('nl-NL', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(n)

// ─── Hero-stattegel ─────────────────────────────────────────────────────────
function StatTile({ label, amount, color, sub }: {
  label: string; amount: number; color: string; sub?: string
}) {
  return (
    <div style={{
      flex: 1, minWidth: 180, background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden',
    }}>
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {fmtEuro(amount)}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ─── Gegroepeerde bar-chart (Menno vs Vincent per kwartaal) ────────────────
// Vaste categorische kleuren (member-kleuren, hergebruikt uit de rest van de
// app voor consistentie). Omdat het kleurpaar niet CVD-veilig is bij 2
// series, leunen we NIET op kleur alleen: elke bar krijgt een directe
// euro-label + naam-initiaal, Vincent's bar krijgt bovendien een subtiel
// streep-patroon zodat identiteit ook zonder kleurperceptie duidelijk is.
function QuarterBarChart({ quarters, byQuarterMember, members }: {
  quarters: string[]
  byQuarterMember: Record<string, Record<string, number>>
  members: { id: string; name: string; color: string }[]
}) {
  const maxVal = Math.max(1, ...quarters.flatMap(q => members.map(m => byQuarterMember[q]?.[m.id] ?? 0)))
  const CHART_H = 180
  const patternId = 'budget-stripe'

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Omzet per kwartaal</div>
        {/* Legende — altijd aanwezig bij 2+ series, tekst blijft in tekst-kleur */}
        <div style={{ display: 'flex', gap: 16 }}>
          {members.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span aria-hidden style={{
                width: 10, height: 10, borderRadius: 2, background: i === 1 ? `url(#${patternId})` : m.color,
                border: `1.5px solid ${m.color}`,
              }} />
              {m.name}
            </div>
          ))}
        </div>
      </div>

      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <pattern id={patternId} width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill={members[1]?.color ?? '#9c7ee8'} opacity={0.35} />
            <line x1="0" y1="0" x2="0" y2="5" stroke={members[1]?.color ?? '#9c7ee8'} strokeWidth="2.5" />
          </pattern>
        </defs>
      </svg>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height: CHART_H, borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
        {quarters.map(q => (
          <div key={q} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '100%', width: '100%', justifyContent: 'center' }}>
              {members.map((m, i) => {
                const val = byQuarterMember[q]?.[m.id] ?? 0
                const h = Math.round((val / maxVal) * (CHART_H - 24))
                return (
                  <div key={m.id} title={`${m.name} · ${quarterLabel(q)} · ${fmtEuro(val)}`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', width: 26 }}>
                    {val > 0 && (
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3, whiteSpace: 'nowrap' }}>
                        {Math.round(val / 1000)}k
                      </div>
                    )}
                    <div style={{
                      width: '100%', height: Math.max(2, h), borderRadius: '3px 3px 0 0',
                      background: i === 1 ? `url(#${patternId})` : m.color,
                      border: `1.5px solid ${m.color}`, borderBottom: 'none',
                      transition: 'height 0.15s',
                    }} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 6 }}>
        {quarters.map(q => (
          <div key={q} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>
            {quarterLabel(q)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Bedrag-inputje met lokale draft-state (commit on blur/Enter) ─────────
function AmountInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '')
  useEffect(() => { setDraft(value ? String(value) : '') }, [value])
  function commit() {
    const n = parseFloat(draft.replace(',', '.'))
    onCommit(Number.isFinite(n) && n >= 0 ? n : 0)
  }
  return (
    <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit() }}
      placeholder="€ 0" inputMode="decimal"
      style={{
        width: 100, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6,
        padding: '5px 8px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', textAlign: 'right',
      }} />
  )
}

// ─── Projecten & verwachte omzet ────────────────────────────────────────────
// Lijst van alle projecten (over alle boards) waar Menno of Vincent owner
// van zijn, gegroepeerd per kwartaal op basis van de effectieve einddatum.
// Hier vul je de VERWACHTE omzet per project in — dat is de forward-looking
// forecast die los staat van de handmatige omzet-regels hieronder (die zijn
// voor omzet die niet aan één specifiek project hangt).
function ProjectRevenueTable({ projects, revenueByItem, members, onSetAmount, onToggleConfirmed }: {
  projects: ForecastProject[]
  revenueByItem: Map<string, ProjectRevenue>
  members: { id: string; name: string; color: string }[]
  onSetAmount: (p: ForecastProject, amount: number) => void
  onToggleConfirmed: (p: ForecastProject) => void
}) {
  const memberById = new Map(members.map(m => [m.id, m]))
  const withQuarter = projects.filter(p => p.endDate)
  const withoutQuarter = projects.filter(p => !p.endDate)
  const quarterGroups = new Map<string, ForecastProject[]>()
  for (const p of withQuarter) {
    const q = quarterOf(new Date(p.endDate as string))
    quarterGroups.set(q, [...(quarterGroups.get(q) ?? []), p])
  }
  const sortedQuarters = [...quarterGroups.keys()].sort()

  function renderRow(p: ForecastProject) {
    const rev = revenueByItem.get(p.itemId)
    return (
      <div key={p.itemId} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
        borderBottom: '1px solid var(--border-light)', fontSize: 13,
      }}>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {p.ownerIds.map(id => (
            <span key={id} aria-hidden title={memberById.get(id)?.name} style={{
              width: 8, height: 8, borderRadius: '50%', background: memberById.get(id)?.color ?? '#888',
            }} />
          ))}
        </div>
        <span style={{
          flex: 1, minWidth: 0, color: 'var(--text-primary)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          opacity: p.status === 'Done' ? 0.55 : 1,
        }}>{p.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.boardName}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, cursor: 'pointer' }}>
          <input type="checkbox" checked={rev?.confirmed ?? false} onChange={() => onToggleConfirmed(p)}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
          bevestigd
        </label>
        <AmountInput value={rev?.amount ?? 0} onCommit={n => onSetAmount(p, n)} />
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        Projecten &amp; verwachte omzet
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Kwartaal = einddatum van het project. Bedragen tellen mee in de grafiek hierboven.
      </p>
      {sortedQuarters.length === 0 && withoutQuarter.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen projecten gevonden met Menno of Vincent als owner.</p>
      )}
      {sortedQuarters.map(q => (
        <div key={q} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            {quarterLabel(q)}
          </div>
          {quarterGroups.get(q)!.map(renderRow)}
        </div>
      ))}
      {withoutQuarter.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Geen datum
          </div>
          {withoutQuarter.map(renderRow)}
        </div>
      )}
    </div>
  )
}

// ─── Entry-formulier ────────────────────────────────────────────────────────
function AddEntryForm({ members, defaultMemberId, onAdd }: {
  members: { id: string; name: string; color: string }[]
  defaultMemberId: string
  onAdd: (e: BudgetEntry) => void
}) {
  const [memberId, setMemberId] = useState(defaultMemberId)
  const [quarter,  setQuarter]  = useState(currentQuarter())
  const [amount,   setAmount]   = useState('')
  const [label,    setLabel]    = useState('')

  function submit() {
    const n = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return
    const now = new Date().toISOString()
    onAdd({ id: genBudgetId(), memberId, quarter, amount: n, label: label.trim() || undefined, createdAt: now, updatedAt: now })
    setAmount(''); setLabel('')
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '7px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-hover)', border: '1px solid var(--border-light)', borderRadius: 8, padding: 10 }}>
      <select value={memberId} onChange={e => setMemberId(e.target.value)} style={inputStyle}>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select value={quarter} onChange={e => setQuarter(e.target.value)} style={inputStyle}>
        {quarterRange(6, 2).reverse().map(q => <option key={q} value={q}>{quarterLabel(q)}</option>)}
      </select>
      <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Bedrag (€)"
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        style={{ ...inputStyle, width: 110 }} inputMode="decimal" />
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Toelichting (optioneel)"
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
      <button onClick={submit} style={{
        background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
        padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}>
        + Toevoegen
      </button>
    </div>
  )
}

// ─── Entry-lijst (gegroepeerd per kwartaal, nieuwste eerst) ───────────────
function EntryList({ entries, members, onDelete }: {
  entries: BudgetEntry[]
  members: { id: string; name: string; color: string }[]
  onDelete: (id: string) => void
}) {
  const memberById = new Map(members.map(m => [m.id, m]))
  const quarters = [...new Set(entries.map(e => e.quarter))].sort().reverse()
  if (quarters.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nog geen omzet-regels ingevoerd.</p>
  }
  return (
    <div>
      {quarters.map(q => {
        const rows = entries.filter(e => e.quarter === q).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return (
          <div key={q} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
              {quarterLabel(q)}
            </div>
            {rows.map(r => {
              const m = memberById.get(r.memberId)
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                  borderBottom: '1px solid var(--border-light)', fontSize: 13,
                }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: m?.color ?? '#888', flexShrink: 0 }} />
                  <span style={{ width: 70, color: 'var(--text-secondary)', flexShrink: 0 }}>{m?.name ?? r.memberId}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', width: 90, flexShrink: 0 }}>{fmtEuro(r.amount)}</span>
                  <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <button onClick={() => onDelete(r.id)} title="Verwijderen"
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#e2445c')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function BudgetPage() {
  const { profile } = useProfile()
  const { members: teamMembers } = useTeam()
  const [entries, setEntries]   = useState<BudgetEntry[]>([])
  const [revenue, setRevenue]   = useState<ProjectRevenue[]>([])
  const [projects, setProjects] = useState<ForecastProject[]>([])
  const [loaded,  setLoaded]    = useState(false)

  useEffect(() => {
    setEntries(loadBudgetEntries())
    setRevenue(loadProjectRevenue())
    setProjects(loadForecastProjects())
    setLoaded(true)
    pullBudgetEntries().then(ok => { if (ok) setEntries(loadBudgetEntries()) })
    pullProjectRevenue().then(ok => { if (ok) setRevenue(loadProjectRevenue()) })
    function onBudgetUpdate()  { setEntries(loadBudgetEntries()) }
    function onRevenueUpdate() { setRevenue(loadProjectRevenue()) }
    // Projecten zelf kunnen in een ANDER tabblad (de planning-borden) worden
    // bewerkt — 'yoko-board-update' vuurt bij elke board-save, dus we
    // herladen de project-lijst zodat een nieuwe deadline/einddatum meteen
    // in het juiste kwartaal valt zonder page-refresh.
    function onBoardUpdate()   { setProjects(loadForecastProjects()) }
    window.addEventListener('yoko-budget-update', onBudgetUpdate)
    window.addEventListener('yoko-project-revenue-update', onRevenueUpdate)
    window.addEventListener('yoko-board-update', onBoardUpdate)
    const offBudget  = subscribeRemoteBudget()
    const offRevenue = subscribeRemoteProjectRevenue()
    return () => {
      window.removeEventListener('yoko-budget-update', onBudgetUpdate)
      window.removeEventListener('yoko-project-revenue-update', onRevenueUpdate)
      window.removeEventListener('yoko-board-update', onBoardUpdate)
      offBudget(); offRevenue()
    }
  }, [])

  const allowed = !!profile && BUDGET_ALLOWED_MEMBER_IDS.includes(profile.memberId)

  const members = useMemo(() => {
    return BUDGET_ALLOWED_MEMBER_IDS.map(id => {
      const m = teamMembers.find(t => t.id === id)
      return { id, name: m?.name ?? id, color: m?.color ?? '#888' }
    })
  }, [teamMembers])

  // 2 kwartalen terug + huidige + 4 vooruit — bewust naar voren geschoven
  // t.o.v. een puur-historisch overzicht: het doel is zien wat er de
  // KOMENDE kwartalen aan omzet binnenkomt, niet alleen wat er al was.
  const quarters = useMemo(() => quarterRange(2, 4), [])

  const revenueByItem = useMemo(() => new Map(revenue.map(r => [r.itemId, r])), [revenue])

  const byQuarterMember = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    const add = (q: string, memberId: string, amount: number) => {
      out[q] ??= {}
      out[q][memberId] = (out[q][memberId] ?? 0) + amount
    }
    for (const e of entries) add(e.quarter, e.memberId, e.amount)
    // Project-omzet: verdeel het bedrag gelijk over de owners die in de
    // Menno/Vincent-allowlist vallen (meestal 1, bij een gedeeld project 2×50%).
    for (const p of projects) {
      const rev = revenueByItem.get(p.itemId)
      if (!rev || rev.amount <= 0 || !p.endDate) continue
      const q = quarterOf(new Date(p.endDate))
      const share = rev.amount / p.ownerIds.length
      for (const ownerId of p.ownerIds) add(q, ownerId, share)
    }
    return out
  }, [entries, projects, revenueByItem])

  const nowQ = currentQuarter()
  const myTotal = profile ? (byQuarterMember[nowQ]?.[profile.memberId] ?? 0) : 0
  const otherMember = members.find(m => m.id !== profile?.memberId)
  const otherTotal = otherMember ? (byQuarterMember[nowQ]?.[otherMember.id] ?? 0) : 0
  const combinedTotal = members.reduce((s, m) => s + (byQuarterMember[nowQ]?.[m.id] ?? 0), 0)

  function handleAdd(e: BudgetEntry) {
    setEntries(prev => [...prev, e])
    upsertBudgetEntry(e)
  }
  function handleDelete(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
    deleteBudgetEntry(id)
  }
  function handleSetAmount(p: ForecastProject, amount: number) {
    const existing = revenueByItem.get(p.itemId)
    const next: ProjectRevenue = {
      itemId: p.itemId, boardId: p.boardId, amount,
      confirmed: existing?.confirmed ?? false, updatedAt: new Date().toISOString(),
    }
    setRevenue(prev => [...prev.filter(r => r.itemId !== p.itemId), next])
    upsertProjectRevenue(next)
  }
  function handleToggleConfirmed(p: ForecastProject) {
    const existing = revenueByItem.get(p.itemId)
    const next: ProjectRevenue = {
      itemId: p.itemId, boardId: p.boardId, amount: existing?.amount ?? 0,
      confirmed: !(existing?.confirmed ?? false), updatedAt: new Date().toISOString(),
    }
    setRevenue(prev => [...prev.filter(r => r.itemId !== p.itemId), next])
    upsertProjectRevenue(next)
  }

  if (!loaded || !profile) return null

  if (!allowed) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Geen toegang</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>
          Deze pagina is alleen zichtbaar voor Menno en Vincent.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChart size={26} />Budget
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Omzet per kwartaal · alleen zichtbaar voor Menno &amp; Vincent
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile label={`Jouw omzet · ${quarterLabel(nowQ)}`} amount={myTotal}
          color={members.find(m => m.id === profile.memberId)?.color ?? 'var(--accent)'} />
        {otherMember && (
          <StatTile label={`${otherMember.name} · ${quarterLabel(nowQ)}`} amount={otherTotal} color={otherMember.color} />
        )}
        <StatTile label={`Totaal team · ${quarterLabel(nowQ)}`} amount={combinedTotal} color="var(--text-muted)" />
      </div>

      <div style={{ marginBottom: 24 }}>
        <QuarterBarChart quarters={quarters} byQuarterMember={byQuarterMember} members={members} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <ProjectRevenueTable projects={projects} revenueByItem={revenueByItem} members={members}
          onSetAmount={handleSetAmount} onToggleConfirmed={handleToggleConfirmed} />
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>Losse omzet-regels</h2>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        Voor omzet die niet aan één specifiek project hangt.
      </p>
      <div style={{ marginBottom: 18 }}>
        <AddEntryForm members={members} defaultMemberId={profile.memberId} onAdd={handleAdd} />
      </div>
      <EntryList entries={entries} members={members} onDelete={handleDelete} />
    </div>
  )
}
