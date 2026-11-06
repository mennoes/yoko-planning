'use client'
import { useState, useEffect, useRef, useContext, createContext } from 'react'
import teamData from '@/data/team.json'
import { useProfile } from './ProfileContext'
import { useTeamPhotos } from './TeamPhotosContext'
import { useTeam } from './TeamContext'
import { UserAvatar } from './UserAvatar'
import { PortalDropdown } from './DateRangeCell'
import { DistributionPie } from './DistributionPie'
import { normalizeOwnerHours, rebalanceOwnerHours } from '@/lib/ownerHours'
export const OwnerUsageCtx = createContext<Record<string, number>>({})
export function MemberAvatar({ id, size = 24 }: { id: string; size?: number }) {
  return <UserAvatar memberId={id} size={size} borderless={false} style={{
    opacity: 1,
    filter: 'none',
    boxShadow: '0 0 0 2px var(--bg-card)',
  }} />
}

function resolveOwnerHours(ownerIds: string[], total: number, stored?: Record<string, number>): Record<string, number> {
  return normalizeOwnerHours(ownerIds, total, stored)
}

export const ownerHoursDrafts = (ids: string[], hours: Record<string, number>) =>
  Object.fromEntries(ids.map(id => [id, String(Math.round((hours[id] ?? 0) * 10) / 10)]))

export function OwnersCell({ value, onChange, ownerHours, totalHours = 0, onDistributionChange, avatarSize = 34, triggerLabel, distributionFromSubitems = false }: {
  value: string[]
  onChange: (v: string[], distribution?: Record<string, number>) => void
  ownerHours?: Record<string, number>
  totalHours?: number
  onDistributionChange?: (v: Record<string, number>) => void
  /** De verdeling is opgeteld uit de subitems. Dan valt er hier niets
   *  te verschuiven: een wijziging op het hoofditem wordt bij de
   *  volgende render overschreven door die optelsom. */
  distributionFromSubitems?: boolean
  /** In een rij moet een gezicht klein blijven; in het item-venster is
   *  er ruimte zat en wil je gewoon zien wie het doet. */
  avatarSize?: number
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trigRef = useRef<HTMLDivElement>(null)
  const { profile } = useProfile()
  const { members: liveTeam } = useTeam()
  const { getPhoto } = useTeamPhotos()
  const usage = useContext(OwnerUsageCtx)
  const ownersKey = value.join(',')
  const hoursKey = JSON.stringify(ownerHours ?? {})
  const [liveHours, setLiveHours] = useState<Record<string, number>>(() => resolveOwnerHours(value, totalHours, ownerHours))
  const [hourDrafts, setHourDrafts] = useState<Record<string, string>>(() => ownerHoursDrafts(value, resolveOwnerHours(value, totalHours, ownerHours)))
  useEffect(() => {
    const resolved = resolveOwnerHours(value, totalHours, ownerHours)
    setLiveHours(resolved)
    setHourDrafts(ownerHoursDrafts(value, resolved))
  }, [ownersKey, totalHours, hoursKey])
  // Bron-lijst: live team_members uit Supabase aangevuld met data/team.json
  // voor leden die nog niet in de DB staan. Zo verschijnen Manuel + andere
  // via /team-admin toegevoegde leden direct als owner-optie zonder dat
  // de hardcoded teamData.json hoeft te worden bijgewerkt.
  //
  // Wie gestopt is, blijft vindbaar. Oud werk heeft een eigenaar gehad en
  // die wil je er soms alsnog bij zetten — een afgeronde klus van vorig
  // jaar was echt van Manuel. Inactieve mensen staan daarom niet tussen
  // de zes snelle gezichten, maar wél in de zoekregel, met 'inactief'
  // erbij zodat je ziet wie je kiest.
  const team = (() => {
    const seen = new Set<string>()
    const knownLive = new Set(liveTeam.map(m => m.id))
    const out: Array<{ id: string; name: string; color?: string; inactive?: boolean }> = []
    for (const m of liveTeam) {
      if (m.hidden) continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, color: m.color, inactive: !!m.inactive })
    }
    for (const m of teamData.members) {
      if (seen.has(m.id) || knownLive.has(m.id)) continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, color: m.color })
    }
    return out
  })()
  const toggle = (id: string) => {
    if (value.includes(id)) {
      const next = value.filter(x => x !== id)
      const distribution = normalizeOwnerHours(next, totalHours,
        Object.fromEntries(next.map(ownerId => [ownerId, liveHours[ownerId] ?? 0])))
      onChange(next, distribution)
      return
    }
    // Bij assignen automatisch 'unassigned' eruit gooien — anders blijft een
    // item zowel een echte owner als 'niemand toegewezen' tegelijk dragen,
    // wat de werkdruk-distributie en filter-chips door de war stuurt.
    const next = id === 'unassigned'
      ? [...value, id]
      : [...value.filter(x => x !== 'unassigned'), id]
    const initial = { ...liveHours, [id]: 0 }
    const distribution = id === 'unassigned'
      ? {}
      : rebalanceOwnerHours(next, initial, totalHours, id, totalHours / Math.max(next.length, 1))
    onChange(next, distribution)
  }

  // Zes meest gebruikte of reeds geselecteerde leden staan direct in
  // beeld. Al het andere, inclusief wie gestopt is, vind je via de
  // zoekregel eronder.
  const sortedTeam = [...team].sort((a, b) => {
    const selectedDelta = Number(value.includes(b.id)) - Number(value.includes(a.id))
    return selectedDelta || (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name, 'nl')
  })
  const quickMembers = sortedTeam.filter(m => !m.inactive || value.includes(m.id)).slice(0, 6)
  const q             = query.trim().toLowerCase()
  const matchedOthers = q
    ? sortedTeam.filter(m => !quickMembers.some(top => top.id === m.id) && (m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)))
    : []
  const activeIds = new Set(team.map(member => member.id))
  const inactiefLabel = (id: string) => team.find(member => member.id === id)?.inactive
    ? <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>inactief</span>
    : null
  // Een expliciet toegewezen owner is altijd een volwaardige contributor.
  // De eerdere 5-wekenheuristiek maakte owners buiten een subitem-window
  // bijna onzichtbaar (20% opacity), zelfs bij een project dat nog moest
  // beginnen. Dat suggereerde ten onrechte dat zij niet meededen. Alleen
  // verborgen/inactieve accounts filteren we nog uit; planning/timeline
  // verandert nooit meer de visuele status van een toegewezen owner.
  const visibleOwners = value.filter(id => activeIds.has(id))
  const hasDistribution = visibleOwners.length > 1 && totalHours > 0
  const memberFor = (id: string) => liveTeam.find(member => member.id === id) ?? teamData.members.find(member => member.id === id)
  const segments = visibleOwners.map(id => {
    const member = memberFor(id)
    return {
      id,
      value: liveHours[id] ?? 0,
      color: member?.color ?? '#9aa3ad',
      label: member?.name ?? id,
      avatarUrl: getPhoto(id),
      initials: member?.name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() ?? '?',
    }
  })
  const commitDistribution = (next: Record<string, number>) => {
    const cleaned = Object.fromEntries(visibleOwners.map(id => [id, Math.max(0, Number(next[id]) || 0)]))
    setLiveHours(cleaned)
    setHourDrafts(ownerHoursDrafts(visibleOwners, cleaned))
    onDistributionChange?.(cleaned)
  }
  const previewTypedHours = (id: string, raw: string) => {
    setHourDrafts(prev => ({ ...prev, [id]: raw }))
    if (raw.trim() === '') return
    const parsed = Number(raw.replace(',', '.'))
    if (!Number.isFinite(parsed)) return
    const next = rebalanceOwnerHours(visibleOwners, liveHours, totalHours, id, parsed)
    setLiveHours(next)
    setHourDrafts({ ...ownerHoursDrafts(visibleOwners, next), [id]: raw })
  }
  const commitTypedHours = (id: string) => {
    const parsed = Number((hourDrafts[id] ?? '').replace(',', '.'))
    if (!Number.isFinite(parsed)) {
      setHourDrafts(ownerHoursDrafts(visibleOwners, liveHours))
      return
    }
    commitDistribution(rebalanceOwnerHours(visibleOwners, liveHours, totalHours, id, parsed))
  }

  function allocatedAvatar(id: string, index: number) {
    if (!hasDistribution) return <MemberAvatar key={id} id={id} size={avatarSize} />
    const member = memberFor(id)
    const hours = liveHours[id] ?? 0
    const pct = totalHours > 0 ? Math.max(0, Math.min(100, hours / totalHours * 100)) : 0
    const color = member?.color ?? '#9aa3ad'
    // De ring met het aandeel zit om de avatar heen, dus die vraagt wat
    // extra ruimte.
    const ring = avatarSize + 4
    return (
      <span key={id} title={`${member?.name ?? id} · ${Math.round(hours * 10) / 10}u · ${Math.round(pct)}%`}
        style={{
          width: ring, height: ring, padding: 4, boxSizing: 'border-box', borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: `conic-gradient(${color} ${pct * 3.6}deg, var(--border) 0deg)`,
          boxShadow: '0 0 0 2px var(--bg-card)',
          marginLeft: index > 0 ? -6 : 0,
          position: 'relative', zIndex: visibleOwners.length - index,
        }}>
        <UserAvatar memberId={id} size={avatarSize - 4} borderless style={{ boxShadow: '0 0 0 2px var(--bg-card)' }} />
      </span>
    )
  }

  return (
    <div>
      <div ref={trigRef} role="button" aria-label={triggerLabel ?? 'Owners wijzigen'} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }} onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{ display: 'flex', gap: 2, cursor: 'pointer', flexWrap: triggerLabel ? 'wrap' : 'nowrap', minWidth: 24 }}>
        {triggerLabel && <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{triggerLabel}</span>}
        {visibleOwners.length === 0
          ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>
          : visibleOwners.map(allocatedAvatar)
        }
      </div>

      {open && (
        <PortalDropdown anchor={trigRef} onClose={() => setOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 6, minWidth: hasDistribution ? 330 : 240,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}>
            {hasDistribution && (
              <div style={{ padding: '10px 10px 12px', marginBottom: 6, borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Verdeling
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <DistributionPie segments={segments} total={totalHours} size={94}
                    interactive={!distributionFromSubitems} showAvatars
                    innerLabel={`${Math.round(totalHours * 10) / 10}u`}
                    onChange={next => { setLiveHours(next); setHourDrafts(ownerHoursDrafts(visibleOwners, next)) }}
                    onCommit={commitDistribution} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
                    {segments.map(segment => {
                      const pct = totalHours > 0 ? Math.round(segment.value / totalHours * 100) : 0
                      return (
                        <div key={segment.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: segment.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{segment.label}</span>
                          {distributionFromSubitems ? (
                            <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                              {Math.round(segment.value * 10) / 10}u · {pct}%
                            </span>
                          ) : (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                            <input type="text" inputMode="decimal" aria-label={`Uren voor ${segment.label}`}
                              value={hourDrafts[segment.id] ?? String(Math.round(segment.value * 10) / 10)}
                              onClick={event => event.stopPropagation()}
                              onFocus={event => event.currentTarget.select()}
                              onChange={event => previewTypedHours(segment.id, event.target.value)}
                              onBlur={() => commitTypedHours(segment.id)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') {
                                  setHourDrafts(ownerHoursDrafts(visibleOwners, liveHours))
                                  event.currentTarget.blur()
                                }
                              }}
                              style={{ width: 43, height: 25, boxSizing: 'border-box', padding: '2px 5px', borderRadius: 5,
                                border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
                                font: 'inherit', fontVariantNumeric: 'tabular-nums', textAlign: 'right', outline: 'none' }} />
                            <span style={{ color: 'var(--text-muted)' }}>u · {pct}%</span>
                          </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--text-muted)' }}>
                  {distributionFromSubitems
                    ? 'Opgeteld uit de subitems — pas de uren daar aan, dan loopt dit mee.'
                    : 'Sleep de witte bolletjes of vul de uren per persoon in.'}
                </div>
              </div>
            )}
            {quickMembers.map(m => {
              const active = value.includes(m.id)
              const isMe   = profile?.memberId === m.id
              return (
                <button key={m.id} onClick={() => toggle(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '7px 8px', borderRadius: 6,
                  background: active ? m.color + '22' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'left',
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                  <MemberAvatar id={m.id} size={32} />
                  <span style={{ fontWeight: active ? 700 : 500 }}>
                    {m.name}{isMe ? ' (jij)' : ''}{inactiefLabel(m.id)}
                  </span>
                  {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 13, fontWeight: 700 }}>✓</span>}
                </button>
              )
            })}

            <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px 6px' }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Zoek iemand…"
              style={{ width: '100%', boxSizing: 'border-box',
                padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border-light)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />

            {/* Externe leden: alleen tonen bij actieve match, of toon
                geselecteerde externen altijd zodat je 'm kunt deselecteren. */}
            {(() => {
              const list = matchedOthers
              if (list.length === 0) {
                if (q) return <div style={{ padding: '8px 8px 4px', fontSize: 12, color: 'var(--text-muted)' }}>Geen match.</div>
                return null
              }
              return (
                <div style={{ marginTop: 4 }}>
                  {list.map(m => {
                    const active = value.includes(m.id)
                    return (
                      <button key={m.id} onClick={() => toggle(m.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '6px 8px', borderRadius: 6,
                        background: active ? m.color + '22' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                      }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                        <MemberAvatar id={m.id} size={24} />
                        <span style={{ fontWeight: active ? 600 : 400 }}>{m.name}{inactiefLabel(m.id)}</span>
                        {active && <span style={{ marginLeft: 'auto', color: m.color, fontSize: 12 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })()}

            {/* Onbekende owners (id's in value die niet in team-lijst zitten,
                bv. Google-meeting-attendees) — toon ze hier expliciet zodat
                de gebruiker ze kan verwijderen. Anders 'plakken' ze in de
                cel zonder dat 'r een uncheck-mogelijkheid is. */}
            {(() => {
              const known = new Set([...team.map(m => m.id), ...liveTeam.map(m => m.id)])
              const orphans = value.filter(id => id && id !== 'unassigned' && !known.has(id))
              if (orphans.length === 0) return null
              return (
                <>
                  <div style={{ height: 1, background: 'var(--border-light)', margin: '6px 4px 4px' }} />
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px' }}>
                    Toegewezen (onbekend)
                  </div>
                  {orphans.map(id => (
                    <button key={id} onClick={() => toggle(id)}
                      title={`Verwijder '${id}' als owner`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '6px 8px', borderRadius: 6,
                        background: 'rgba(226,68,92,0.10)', border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                      }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%',
                        background: '#e2445c22', color: '#e2445c',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700 }}>{id.slice(0, 2).toUpperCase()}</span>
                      <span>{id}</span>
                      <span style={{ marginLeft: 'auto', color: '#e2445c', fontSize: 14, fontWeight: 700 }}>×</span>
                    </button>
                  ))}
                </>
              )
            })()}
          </div>
        </PortalDropdown>
      )}
    </div>
  )
}

