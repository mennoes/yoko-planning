'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import type { AiItemPlan } from '@/lib/aiPlan'
import { addDays, daysBetween, changePlanPeriod, updatePlanSteps } from '@/lib/planTimeline'
import { werkdagenIn } from '@/lib/sjabloonPlan'
import { naarNl } from '@/lib/datumInvoer'
import { useTeam } from './TeamContext'
import { UserAvatar } from './UserAvatar'
import { IconUserPlus, IconUsers } from './Icon'
import { useTeamGroups } from './useTeamGroups'
import { teamTodaySections } from '@/lib/teamToday'

function RemoveStepIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg>
}

export function PlanOwners({ ids, onChange, label, allowedIds }: { allowedIds: Set<string>; ids: string[]; onChange: (ids: string[]) => void; label: string }) {
  const { members } = useTeam()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div ref={root} style={{ position: 'relative', flexShrink: 0 }}>
    <button type="button" aria-label={`Owners van ${label}`} aria-expanded={open} onClick={() => setOpen(!open)}
      style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid var(--border-light)', borderRadius: 10, padding: 5, minWidth: 32, minHeight: 32, background: 'var(--bg-hover)', color: 'var(--text-muted)', cursor: 'pointer' }}>
      {ids.slice(0, 2).map(id => <UserAvatar key={id} memberId={id} size={24} />)}{ids.length > 2 && <span style={{ fontSize: 10 }}>+{ids.length - 2}</span>}<IconUserPlus size={16} style={{ margin: '0 3px' }} />
    </button>
    {open && <div role="group" aria-label={`Owners kiezen voor ${label}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
      style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 6px)', width: 220, zIndex: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 8, boxShadow: '0 12px 30px #0004' }}>
      <input aria-label="Zoek owner" placeholder="Zoek iemand…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 8, background: 'var(--bg-hover)', color: 'var(--text-primary)', border: 0, borderRadius: 7 }} />
      <div style={{ maxHeight: 210, overflowY: 'auto', marginTop: 5 }}>
        {members.filter(m => (allowedIds.has(m.id) || ids.includes(m.id)) && m.id !== 'unassigned' && m.name.toLowerCase().includes(query.toLowerCase())).map(m => <button type="button" key={m.id} aria-pressed={ids.includes(m.id)} onClick={() => onChange(ids.includes(m.id) ? ids.filter(id => id !== m.id) : [...ids, m.id])}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 6px', border: 0, borderRadius: 7, background: ids.includes(m.id) ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' }}>
          <UserAvatar memberId={m.id} size={26} /><span style={{ flex: 1 }}>{m.name}</span>{ids.includes(m.id) && '✓'}
        </button>)}
      </div>
    </div>}
  </div>
}

export function PlanTimeline({ plan, onChange }: { plan: AiItemPlan; onChange: (plan: AiItemPlan) => void }) {
  const { members } = useTeam()
  const { sections } = useTeamGroups()
  const [selectedTeams, setSelectedTeams] = useState<string[]>(['__yoko__'])
  const teamOptions = teamTodaySections(members.filter(m => !m.inactive && !m.hidden).map(m => ({ id: m.id, name: m.name, yoko: m.kind === 'yoko', activeToday: true })), sections, {}, true)
  const allowedIds = new Set(teamOptions.filter(team => selectedTeams.includes(team.id)).flatMap(team => team.members.map(m => m.id)))
  const [ownerDrag, setOwnerDrag] = useState<string | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const [drag, setDrag] = useState<{ index: number; preview: AiItemPlan } | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const dates = [plan.startDate, plan.endDate, ...plan.subitems.flatMap(s => [s.startDate, s.endDate])].filter((d): d is string => !!d)
  if (!dates.length) return null
  const from = addDays(dates.reduce((a,b) => a < b ? a : b), -3)
  const to = addDays(dates.reduce((a,b) => a > b ? a : b), 3)
  const length = daysBetween(from, to) + 1
  const shown = drag?.preview ?? plan
  const rows = [shown, ...shown.subitems]
  function start(e: React.PointerEvent, index: number, kind: 'move' | 'start' | 'end') {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    cleanup.current?.()
    const width = (track.current?.getBoundingClientRect().width ?? 1) / length
    const x = e.clientX
    const preview = (clientX: number) => changePlanPeriod(plan, index, kind, Math.round((clientX - x) / width))
    setDrag({ index, preview: plan })
    const move = (ev: PointerEvent) => setDrag({ index, preview: preview(ev.clientX) })
    const clear = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); cleanup.current = null }
    const up = (ev: PointerEvent) => { clear(); setDrag(null); onChange(preview(ev.clientX)) }
    const cancel = () => { clear(); setDrag(null) }
    cleanup.current = clear
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
  }
  return <div data-voorstel-tijdlijn style={{ padding: '8px 2px' }}>
    <style>{`
      .plan-row,.plan-axis { display:grid; grid-template-columns:230px minmax(0,1fr) 90px 30px; gap:10px; }
      .plan-remove:hover,.plan-remove:focus-visible { color:var(--red,#e2445c)!important; background:var(--bg-hover)!important; }
      .plan-days::-webkit-inner-spin-button,.plan-days::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
      @media(max-width:650px) {
        .plan-row { grid-template-columns:minmax(0,1fr) auto 24px; gap:8px; }
        .plan-track { grid-column:1 / -1; grid-row:2; }
        .plan-axis { display:none; }
      }
    `}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Owners</span>
      {members.filter(m => allowedIds.has(m.id)).map(m => <button key={m.id} draggable aria-label={`${m.name} op hoofditem zetten`} title={`${m.name} · sleep naar een item of klik voor het hoofditem`}
        onDragStart={e => { e.dataTransfer.setData('application/x-yoko-owner',m.id); setOwnerDrag(m.id) }} onDragEnd={() => setOwnerDrag(null)}
        onClick={() => onChange({ ...plan, ownerIds: plan.ownerIds.includes(m.id) ? plan.ownerIds.filter(id => id !== m.id) : [...plan.ownerIds,m.id] })}
        style={{ padding: 2, border: plan.ownerIds.includes(m.id) ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: '50%', background: 'var(--bg-hover)', cursor: 'grab' }}><UserAvatar memberId={m.id} size={26} /></button>)}
      <details style={{ marginLeft: 'auto', position: 'relative' }}>
        <summary aria-label="Teams kiezen" style={{ display: 'flex', alignItems: 'center', gap: 7, listStyle: 'none', cursor: 'pointer', padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}><IconUsers size={15} />Teams · {selectedTeams.length}<span aria-hidden>⌄</span></summary>
        <div role="group" aria-label="Zichtbare teams" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 220, zIndex: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 10, boxShadow: '0 12px 30px #0004' }}>
          {teamOptions.map(team => <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 5px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedTeams.includes(team.id)} onChange={e => setSelectedTeams(current => e.target.checked ? [...current,team.id] : current.filter(id => id !== team.id))} />
            <span style={{ flex: 1 }}>{team.name === 'Freelancers vandaag' ? 'Freelancers' : team.name}</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{team.members.length}</span>
          </label>)}
        </div>
      </details>
      {allowedIds.size === 0 && <span style={{ width: '100%', color: 'var(--text-muted)', fontSize: 12 }}>Kies een team om owners te tonen.</span>}
    </div>
    <div>
      <div className="plan-axis" style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 10 }}>
        <span /> <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{naarNl(from)}</span><span style={{ opacity: .7 }}>Werkdagen</span><span>{naarNl(to)}</span></div>
      </div>
      {rows.map((row, rowIndex) => {
        const index = rowIndex - 1
        const days = row.startDate && row.endDate ? werkdagenIn(row.startDate, row.endDate) : 0
        const active = drag?.index === index
        const left = row.startDate ? daysBetween(from, row.startDate) / length * 100 : 0
        const width = row.startDate && row.endDate ? (daysBetween(row.startDate, row.endDate) + 1) / length * 100 : 0
        return <Fragment key={rowIndex}>
          {index === 0 && <div style={{ margin: '18px 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '.09em', color: 'var(--text-muted)' }}>SUBITEMS · {plan.subitems.length}</div>}
          <div className="plan-row" onDragOver={e => { if (ownerDrag) e.preventDefault() }} onDrop={e => {
          e.preventDefault()
          const id = e.dataTransfer.getData('application/x-yoko-owner')
          setOwnerDrag(null)
          if (!members.some(m => m.id === id) || row.ownerIds.includes(id)) return
          onChange(index < 0 ? { ...plan, ownerIds: [...plan.ownerIds,id] } : { ...plan, subitems: plan.subitems.map((s,i) => i === index ? { ...s, ownerIds: [...s.ownerIds,id] } : s) })
        }} style={{ outline: ownerDrag ? '1px dashed var(--accent)' : undefined, borderRadius: index < 0 ? 12 : 6, alignItems: 'center', padding: index < 0 ? '14px 0' : '8px 0', background: index < 0 ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : undefined, borderLeft: index < 0 ? '3px solid var(--accent)' : '3px solid var(--border-light)', borderBottom: index < 0 ? undefined : '1px solid var(--border-light)' }}>
          <div style={{ minWidth: 0, paddingLeft: index < 0 ? 12 : 18 }}>
            {index < 0 && <div style={{ marginBottom: 6, color: 'var(--accent)', fontSize: 9, fontWeight: 800, letterSpacing: '.1em' }}>TOTAAL PROJECT</div>}
            <input aria-label={index < 0 ? 'Naam hoofditem' : `Naam subitem ${rowIndex}`} value={row.name} onChange={e => onChange(index < 0 ? { ...plan, name: e.target.value } : { ...plan, subitems: plan.subitems.map((s,i) => i === index ? { ...s, name: e.target.value } : s) })}
              style={{ border: 0, padding: 0, width: '100%', background: 'transparent', color: 'var(--text-primary)', fontWeight: index < 0 ? 750 : 500, fontSize: index < 0 ? 15 : 13 }} />
            <div style={{ marginTop: 4, fontSize: 11.5, color: active ? 'var(--accent)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{naarNl(row.startDate)} → {naarNl(row.endDate)} · {row.estHours}u</div>
          </div>
          <div className="plan-track" ref={index < 0 ? track : undefined} style={{ position: 'relative', height: index < 0 ? 38 : 28, background: 'var(--bg-hover)', borderRadius: 8 }}>
            {Array.from({ length }, (_,i) => werkdagenIn(addDays(from,i), addDays(from,i)) === 0 && <span key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${i / length * 100}%`, width: `${100 / length}%`, background: 'var(--overlay-faint)' }} />)}
            {days > 0 && <div role="slider" tabIndex={0} aria-label={`Periode van ${row.name}`} aria-valuetext={`${naarNl(row.startDate)} tot ${naarNl(row.endDate)}`} data-stap-balk={index}
              onPointerDown={e => start(e,index,'move')}
              onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange(changePlanPeriod(plan,index,e.shiftKey ? 'end' : 'move',e.key === 'ArrowLeft' ? -1 : 1)) } }}
              style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, minWidth: 36, insetBlock: 2, borderRadius: 7, background: index < 0 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 24%, var(--bg-card))', color: index < 0 ? '#171717' : 'var(--text-primary)', border: index < 0 ? undefined : '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', boxSizing: 'border-box', cursor: active ? 'grabbing' : 'grab', touchAction: 'none', boxShadow: active ? '0 4px 12px #0004' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span onPointerDown={e => start(e,index,'start')} title="Start verslepen" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', borderLeft: '2px solid #ffffff80', borderRadius: 7 }} />
              <input className="plan-days" key={`${row.startDate}-${row.endDate}`} aria-label={`Werkdagen van ${row.name}`} title="Aantal werkdagen aanpassen" type="number" min={1} max={365} defaultValue={days}
                onPointerDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
                onBlur={e => { const n = Number(e.target.value); if (n >= 1 && n !== days) onChange(changePlanPeriod(plan,index,'days',n)); else e.target.value = String(days) }}
                style={{ width: 24, padding: 0, border: 0, outline: 0, background: 'transparent', color: 'inherit', fontSize: 11, fontWeight: 750, textAlign: 'center', MozAppearance: 'textfield' }} />
              <span onPointerDown={e => start(e,index,'end')} title="Eind verslepen" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', borderRight: '2px solid #ffffff80', borderRadius: 7 }} />
              {active && <span style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', background: 'var(--text-primary)', color: 'var(--bg-base)', fontSize: 11, borderRadius: 6, padding: '5px 8px', pointerEvents: 'none', zIndex: 3 }}>{naarNl(row.startDate)} → {naarNl(row.endDate)}</span>}
            </div>}
          </div>
          <PlanOwners allowedIds={allowedIds} label={row.name} ids={row.ownerIds} onChange={ownerIds => onChange(index < 0 ? { ...plan, ownerIds } : { ...plan, subitems: plan.subitems.map((s,i) => i === index ? { ...s, ownerIds } : s) })} />
          {index >= 0 && <button className="plan-remove" aria-label={`${row.name} verwijderen`} title="Subitem verwijderen" onClick={() => onChange(updatePlanSteps(plan,plan.subitems.filter((_,i) => i !== index)))} style={{ background: 'transparent', border: 0, color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 8, width: 28, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .15s, background .15s' }}><RemoveStepIcon /></button>}
        </div></Fragment>
      })}
    </div>
  </div>
}
