'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useProfile } from './ProfileContext'
import { UserAvatar } from './UserAvatar'
import { IconUsers } from './Icon'
import { parseTeamTodayVisibility, teamTodaySections, type TodayMember, type TodaySection } from '@/lib/teamToday'

type Availability = { kind: string; detail?: string }
const buttonStyle = { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', padding: '6px 10px', fontSize: 12, cursor: 'pointer' } as const

export function TeamTodayCard({ members, sections, statusFor }: {
  members: TodayMember[]
  sections: TodaySection[]
  statusFor: (id: string, name: string) => Availability
}) {
  const { profile } = useProfile()
  const storageKey = `yoko-team-today-visibility:${profile?.memberId ?? 'anonymous'}`
  const [saved, setSaved] = useState<{ key: string; values: Record<string, boolean> }>({ key: '', values: {} })
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const visibility = saved.key === storageKey ? saved.values : {}
  useEffect(() => {
    const read = () => {
      try { setSaved({ key: storageKey, values: parseTeamTodayVisibility(localStorage.getItem(storageKey)) }) }
      catch { setSaved({ key: storageKey, values: {} }) }
    }
    read()
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) read() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey])
  function save(values: Record<string, boolean>) {
    setSaved({ key: storageKey, values })
    try { localStorage.setItem(storageKey, JSON.stringify(values)); setError('') }
    catch { setError('Je keuze kon niet worden bewaard. Probeer het opnieuw.') }
  }
  const shown = teamTodaySections(members, sections, visibility)
  const options = teamTodaySections(members, sections, {}, true)
  const shownIds = new Set(shown.flatMap(section => section.members.map(member => member.id)))
  const available = (people: TodayMember[]) => people.filter(member => statusFor(member.id, member.name).kind === 'available').length
  const shownMembers = shown.flatMap(section => section.members)
  return (
    <section aria-label="Team vandaag" style={{ background: 'var(--bg-card)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--surface-shadow)' }}>
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', background: 'var(--overlay-faint)' }}>
        <Link href="/team" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
          <h2 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconUsers size={15} />Team vandaag
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({available(shownMembers)}/{shownMembers.length}) ›</span>
          </h2>
        </Link>
        <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)} style={buttonStyle}>
          {editing ? 'Klaar' : 'Zichtbaarheid'}
        </button>
      </div>
      {editing && <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>Kies wie je hier ziet. Dit verandert alleen jouw overzicht.</p>
        {options.map(section => <fieldset key={section.id} style={{ border: 0, margin: '0 0 12px', padding: 0 }}>
          <legend style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>{section.name === 'Freelancers vandaag' ? 'Freelancers' : section.name}</legend>
          {section.members.map(member => <label key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={shownIds.has(member.id)} onChange={event => save({ ...visibility, [member.id]: event.target.checked })} />
            <UserAvatar memberId={member.id} size={22} />{member.name}
          </label>)}
        </fieldset>)}
        <button type="button" style={buttonStyle} onClick={() => save({})}>Standaard herstellen</button>
      </div>}
      {error && <p role="alert" style={{ padding: '0 18px', fontSize: 12 }}>{error}</p>}
      <div style={{ padding: '6px 0 10px' }}>
        {shown.length === 0 && <p style={{ padding: '0 18px', fontSize: 13, color: 'var(--text-muted)' }}>Niemand zichtbaar. Kies personen via Zichtbaarheid.</p>}
        {shown.map(section => <div key={section.id}>
          <h3 style={{ display: 'flex', gap: 8, margin: '2px 0 0', padding: '6px 18px 2px', fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>{section.name}</span>
            <span style={{ fontWeight: 400 }}>· {available(section.members)}/{section.members.length}</span>
          </h3>
          {section.members.map(member => {
            const status = statusFor(member.id, member.name)
            const tone = status.kind === 'vacation' ? { bg: 'rgba(255,123,36,0.15)', fg: '#a05400', label: '🏝 ' + (status.detail ?? 'op vakantie') }
              : status.kind === 'free' ? { bg: 'rgba(154,149,144,0.18)', fg: 'var(--text-muted)', label: status.detail ?? 'vrij' }
              : { bg: 'rgba(95,160,110,0.15)', fg: '#3b7a4b', label: 'beschikbaar' }
            return <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 18px' }}>
              <UserAvatar memberId={member.id} size={22} />
              <Link href={`/profile/${member.id}`} style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none' }}>{member.name}</Link>
              <span style={{ fontSize: 11, fontWeight: 600, color: tone.fg, background: tone.bg, padding: '2px 8px', borderRadius: 10 }}>{tone.label}</span>
            </div>
          })}
        </div>)}
      </div>
    </section>
  )
}
