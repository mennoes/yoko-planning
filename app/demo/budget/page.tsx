'use client'

// DEMO-VARIANT van app/budget/page.tsx — zelfde structuur/gedrag, maar:
//  - géén van de Supabase-backed budgetStore/projectRevenueStore/
//    revenueTemplateStore-functies (die lezen/schrijven ECHTE omzetdata) —
//    in plaats daarvan lib/demoBudgetStore.ts, een puur lokale, met
//    '-demo'-geprefixte localStorage-variant.
//  - BUDGET_ALLOWED_MEMBER_IDS ('menno'/'vincent') bestaat niet in de
//    demo-teamledenlijst → vervangen door DEMO_BUDGET_ALLOWED_MEMBER_IDS
//    ('demo-sam'/'demo-jules', de twee demo-leden die in buildDemoBoards()
//    het vaakst als owner voorkomen).
//  - Board-items komen nog steeds via de echte getBoards()/loadGroups(),
//    die al demo-bewust zijn (boardsRegistry's readCache() geeft
//    DEMO_FALLBACK op /demo) — hier alleen met buildDemoBoards() als seed,
//    zoals de demo-bordpagina dat ook doet.
import { useState, useEffect, useMemo } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { useTeam } from '@/components/TeamContext'
import {
  type DemoBudgetEntry, type DemoProjectRevenue, type DemoRevenueTemplate,
  DEMO_BUDGET_ALLOWED_MEMBER_IDS,
  loadDemoBudgetEntries, upsertDemoBudgetEntry, deleteDemoBudgetEntry, onDemoBudgetUpdate, genDemoBudgetId,
  loadDemoProjectRevenue, upsertDemoProjectRevenue, onDemoProjectRevenueUpdate,
  loadDemoRevenueTemplates, upsertDemoRevenueTemplate, onDemoRevenueTemplateUpdate,
  quarterRange, quarterOf, quarterLabel, currentQuarter,
} from '@/lib/demoBudgetStore'
import { getBoards } from '@/lib/boardsRegistry'
import { loadGroups } from '@/lib/boardStore'
import type { BoardItem } from '@/lib/boards'
import { buildDemoBoards } from '@/lib/demoFixtures'
import { isVrijTitle } from '@/lib/workloadCategory'
import { normalizeTitle } from '@/lib/subitemRules'
import { IconChart } from '@/components/Icon'

// ─── Project-lijst (Sam/Jules als owner, over alle demo-boards) ───────────
type ForecastSubitem = {
  id:        string
  name:      string
  status:    string
  startDate: string | null
  endDate:   string | null
}

type ForecastProject = {
  itemId:   string
  boardId:  string
  boardName: string
  name:     string
  ownerIds: string[]     // subset ∩ DEMO_BUDGET_ALLOWED_MEMBER_IDS
  status:   string
  endDate:  string | null  // effectieve einddatum (subitem-rollup), bepaalt kwartaal
  subitems: ForecastSubitem[]  // alleen voor context — geen eigen omzet-veld
  pattern:  string | null  // genormaliseerde naam — null als te kort om betrouwbaar te zijn
}

const MIN_PATTERN_LENGTH = 8

function templateKeyOf(boardId: string, pattern: string): string {
  return `${boardId}::${pattern}`
}

// Zelfde subitem-rollup als de echte pagina — vroegste/laatste actieve-
// subitem-datum wint van het eigen (mogelijk stale) veld van de parent.
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
  const demoBoards = buildDemoBoards()
  const out: ForecastProject[] = []
  for (const board of getBoards()) {
    const seed = demoBoards[board.id]?.groups ?? []
    const groups = loadGroups(board.id, seed)
    for (const g of groups) {
      for (const item of g.items) {
        if ((item.name ?? '').trim() === 'Nieuw item') continue
        if (isVrijTitle(item.name)) continue
        if (item.source === 'google') continue
        const owned = (item.ownerIds ?? []).filter(id => DEMO_BUDGET_ALLOWED_MEMBER_IDS.includes(id))
        if (owned.length === 0) continue
        const normalized = normalizeTitle(item.name)
        out.push({
          itemId: `${board.id}__${item.id}`, boardId: board.id, boardName: board.name,
          name: item.name, ownerIds: owned, status: item.status,
          endDate: effectiveEndDateOf(item),
          subitems: (item.subitems ?? [])
            .map(s => ({ id: s.id, name: s.name, status: s.status, startDate: s.startDate, endDate: s.endDate }))
            .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')),
          pattern: normalized.length >= MIN_PATTERN_LENGTH ? normalized : null,
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

// ─── Gegroepeerde bar-chart (Sam vs Jules per kwartaal) ────────────────────
function QuarterBarChart({ quarters, byQuarterMember, members }: {
  quarters: string[]
  byQuarterMember: Record<string, Record<string, number>>
  members: { id: string; name: string; color: string }[]
}) {
  const maxVal = Math.max(1, ...quarters.flatMap(q => members.map(m => byQuarterMember[q]?.[m.id] ?? 0)))
  const CHART_H = 180
  const patternId = 'demo-budget-stripe'

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Omzet per kwartaal</div>
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
function AmountInput({ value, isEstimate, onCommit }: { value: number; isEstimate?: boolean; onCommit: (n: number) => void }) {
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
      title={isEstimate ? 'Schatting via herkend patroon — typ een bedrag om dit specifieke item te overrulen' : undefined}
      style={{
        width: 100, background: 'var(--bg-base)',
        border: isEstimate ? '1px dashed var(--border)' : '1px solid var(--border)',
        borderRadius: 6, padding: '5px 8px',
        color: isEstimate ? 'var(--text-muted)' : 'var(--text-primary)',
        fontStyle: isEstimate ? 'italic' : 'normal',
        fontSize: 13, outline: 'none', textAlign: 'right',
      }} />
  )
}

// ─── Herkende patronen (terugkerende reeksen) ──────────────────────────────
type PatternGroup = { key: string; boardId: string; boardName: string; pattern: string; projects: ForecastProject[] }

function PatternsSection({ groups, templates, onSetDefault }: {
  groups: PatternGroup[]
  templates: Map<string, DemoRevenueTemplate>
  onSetDefault: (g: PatternGroup, amount: number) => void
}) {
  if (groups.length === 0) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        Herkende patronen
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Terugkerende reeksen — één bedrag hier telt automatisch als schatting voor elk item in de reeks (incl. toekomstige), tenzij je een item hieronder een eigen bedrag geeft.
      </p>
      {groups.map(g => {
        const t = templates.get(templateKeyOf(g.boardId, g.pattern))
        return (
          <div key={g.key} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
            borderBottom: '1px solid var(--border-light)', fontSize: 13,
          }}>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.pattern}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
              {g.projects.length}× · {g.boardName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>per item</span>
            <AmountInput value={t?.defaultAmount ?? 0} onCommit={n => onSetDefault(g, n)} />
          </div>
        )
      })}
    </div>
  )
}

// ─── Projecten & verwachte omzet ────────────────────────────────────────────
function ProjectRevenueTable({ projects, revenueByItem, templates, members, onSetAmount, onToggleConfirmed }: {
  projects: ForecastProject[]
  revenueByItem: Map<string, DemoProjectRevenue>
  templates: Map<string, DemoRevenueTemplate>
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  function toggleExpanded(itemId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  function renderRow(p: ForecastProject) {
    const rev = revenueByItem.get(p.itemId)
    const hasSubitems = p.subitems.length > 0
    const isExpanded = expandedIds.has(p.itemId)
    return (
      <div key={p.itemId}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
        borderBottom: hasSubitems && isExpanded ? 'none' : '1px solid var(--border-light)', fontSize: 13,
      }}>
        <button onClick={() => hasSubitems && toggleExpanded(p.itemId)}
          title={hasSubitems ? `${p.subitems.length} subitem${p.subitems.length === 1 ? '' : 's'}` : undefined}
          style={{
            background: 'none', border: 'none', padding: 0, width: 14, flexShrink: 0,
            cursor: hasSubitems ? 'pointer' : 'default', fontSize: 10, lineHeight: 1,
            color: hasSubitems ? 'var(--text-secondary)' : 'transparent',
          }}>{hasSubitems ? (isExpanded ? '▼' : '▶') : '·'}</button>
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
        {(() => {
          const explicit = rev?.amount ?? 0
          const templateAmount = p.pattern ? (templates.get(templateKeyOf(p.boardId, p.pattern))?.defaultAmount ?? 0) : 0
          const displayAmount = explicit > 0 ? explicit : templateAmount
          const isEstimate = explicit <= 0 && templateAmount > 0
          return <AmountInput value={displayAmount} isEstimate={isEstimate} onCommit={n => onSetAmount(p, n)} />
        })()}
      </div>
      {hasSubitems && isExpanded && (
        <div style={{ borderBottom: '1px solid var(--border-light)' }}>
          {p.subitems.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px 5px 38px',
              fontSize: 12, color: 'var(--text-muted)',
            }}>
              <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                opacity: s.status === 'Done' ? 0.55 : 1,
              }}>{s.name}</span>
              {(s.startDate || s.endDate) && (
                <span style={{ fontSize: 11, flexShrink: 0 }}>
                  {s.startDate ?? '?'} – {s.endDate ?? '?'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
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
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Geen projecten gevonden met Sam of Jules als owner.</p>
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
  onAdd: (e: DemoBudgetEntry) => void
}) {
  const [memberId, setMemberId] = useState(defaultMemberId)
  const [quarter,  setQuarter]  = useState(currentQuarter())
  const [amount,   setAmount]   = useState('')
  const [label,    setLabel]    = useState('')

  function submit() {
    const n = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return
    const now = new Date().toISOString()
    onAdd({ id: genDemoBudgetId(), memberId, quarter, amount: n, label: label.trim() || undefined, createdAt: now, updatedAt: now })
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
  entries: DemoBudgetEntry[]
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
export default function DemoBudgetPage() {
  const { profile } = useProfile()
  const { members: teamMembers } = useTeam()
  const [entries, setEntries]     = useState<DemoBudgetEntry[]>([])
  const [revenue, setRevenue]     = useState<DemoProjectRevenue[]>([])
  const [templates, setTemplates] = useState<DemoRevenueTemplate[]>([])
  const [projects, setProjects]   = useState<ForecastProject[]>([])
  const [loaded,  setLoaded]      = useState(false)

  useEffect(() => {
    setEntries(loadDemoBudgetEntries())
    setRevenue(loadDemoProjectRevenue())
    setTemplates(loadDemoRevenueTemplates())
    setProjects(loadForecastProjects())
    setLoaded(true)
    function onBudgetUpdate()   { setEntries(loadDemoBudgetEntries()) }
    function onRevenueUpdate()  { setRevenue(loadDemoProjectRevenue()) }
    function onTemplateUpdate() { setTemplates(loadDemoRevenueTemplates()) }
    // Projecten zelf kunnen in een ANDER tabblad (de demo planning-borden)
    // worden bewerkt — 'yoko-board-update' vuurt bij elke board-save, dus
    // we herladen de project-lijst zodat een nieuwe deadline meteen in het
    // juiste kwartaal valt zonder page-refresh.
    function onBoardUpdate()   { setProjects(loadForecastProjects()) }
    window.addEventListener('yoko-board-update', onBoardUpdate)
    const offBudget    = onDemoBudgetUpdate(onBudgetUpdate)
    const offRevenue   = onDemoProjectRevenueUpdate(onRevenueUpdate)
    const offTemplates = onDemoRevenueTemplateUpdate(onTemplateUpdate)
    return () => {
      window.removeEventListener('yoko-board-update', onBoardUpdate)
      offBudget(); offRevenue(); offTemplates()
    }
  }, [])

  // In de demo is er geen route-guard nodig zoals in de echte app (die
  // afscherming zit server-side via RLS) — maar we behouden hetzelfde
  // 'Geen toegang'-gedrag voor profielen buiten de demo-allowlist, zodat
  // het profiel-wissel-gedrag zich identiek voelt aan de echte pagina.
  const allowed = !!profile && DEMO_BUDGET_ALLOWED_MEMBER_IDS.includes(profile.memberId)

  const members = useMemo(() => {
    return DEMO_BUDGET_ALLOWED_MEMBER_IDS.map(id => {
      const m = teamMembers.find(t => t.id === id)
      return { id, name: m?.name ?? id, color: m?.color ?? '#888' }
    })
  }, [teamMembers])

  const quarters = useMemo(() => quarterRange(2, 4), [])

  const revenueByItem = useMemo(() => new Map(revenue.map(r => [r.itemId, r])), [revenue])
  const templateByKey = useMemo(
    () => new Map(templates.map(t => [templateKeyOf(t.boardId, t.pattern), t])),
    [templates],
  )

  const patternGroups = useMemo(() => {
    const byKey = new Map<string, PatternGroup>()
    for (const p of projects) {
      if (!p.pattern) continue
      const key = templateKeyOf(p.boardId, p.pattern)
      const g = byKey.get(key)
      if (g) g.projects.push(p)
      else byKey.set(key, { key, boardId: p.boardId, boardName: p.boardName, pattern: p.pattern, projects: [p] })
    }
    return [...byKey.values()].filter(g => g.projects.length >= 2).sort((a, b) => b.projects.length - a.projects.length)
  }, [projects])

  function effectiveAmountOf(p: ForecastProject): number {
    const explicit = revenueByItem.get(p.itemId)?.amount ?? 0
    if (explicit > 0) return explicit
    if (!p.pattern) return 0
    return templateByKey.get(templateKeyOf(p.boardId, p.pattern))?.defaultAmount ?? 0
  }

  const byQuarterMember = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    const add = (q: string, memberId: string, amount: number) => {
      out[q] ??= {}
      out[q][memberId] = (out[q][memberId] ?? 0) + amount
    }
    for (const e of entries) add(e.quarter, e.memberId, e.amount)
    for (const p of projects) {
      const amount = effectiveAmountOf(p)
      if (amount <= 0 || !p.endDate) continue
      const q = quarterOf(new Date(p.endDate))
      const share = amount / p.ownerIds.length
      for (const ownerId of p.ownerIds) add(q, ownerId, share)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, projects, revenueByItem, templateByKey])

  const nowQ = currentQuarter()
  const myTotal = profile ? (byQuarterMember[nowQ]?.[profile.memberId] ?? 0) : 0
  const otherMember = members.find(m => m.id !== profile?.memberId)
  const otherTotal = otherMember ? (byQuarterMember[nowQ]?.[otherMember.id] ?? 0) : 0
  const combinedTotal = members.reduce((s, m) => s + (byQuarterMember[nowQ]?.[m.id] ?? 0), 0)

  function handleAdd(e: DemoBudgetEntry) {
    setEntries(prev => [...prev, e])
    upsertDemoBudgetEntry(e)
  }
  function handleDelete(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
    deleteDemoBudgetEntry(id)
  }
  function handleSetAmount(p: ForecastProject, amount: number) {
    const existing = revenueByItem.get(p.itemId)
    const next: DemoProjectRevenue = {
      itemId: p.itemId, boardId: p.boardId, amount,
      confirmed: existing?.confirmed ?? false, updatedAt: new Date().toISOString(),
    }
    setRevenue(prev => [...prev.filter(r => r.itemId !== p.itemId), next])
    upsertDemoProjectRevenue(next)
  }
  function handleToggleConfirmed(p: ForecastProject) {
    const existing = revenueByItem.get(p.itemId)
    const next: DemoProjectRevenue = {
      itemId: p.itemId, boardId: p.boardId, amount: existing?.amount ?? 0,
      confirmed: !(existing?.confirmed ?? false), updatedAt: new Date().toISOString(),
    }
    setRevenue(prev => [...prev.filter(r => r.itemId !== p.itemId), next])
    upsertDemoProjectRevenue(next)
  }
  function handleSetPatternDefault(g: PatternGroup, amount: number) {
    const next: DemoRevenueTemplate = { pattern: g.pattern, boardId: g.boardId, defaultAmount: amount, updatedAt: new Date().toISOString() }
    setTemplates(prev => [...prev.filter(t => templateKeyOf(t.boardId, t.pattern) !== g.key), next])
    upsertDemoRevenueTemplate(next)
  }

  if (!loaded || !profile) return null

  if (!allowed) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Geen toegang</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>
          Deze pagina is alleen zichtbaar voor {members.map(m => m.name).join(' & ')}.
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
        Omzet per kwartaal · alleen zichtbaar voor {members.map(m => m.name).join(' & ')}
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
        <PatternsSection groups={patternGroups} templates={templateByKey} onSetDefault={handleSetPatternDefault} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <ProjectRevenueTable projects={projects} revenueByItem={revenueByItem} templates={templateByKey} members={members}
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
