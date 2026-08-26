'use client'

// DEMO-VARIANT van app/team-admin/page.tsx — zelfde UI/gedrag (toevoegen,
// bewerken, verwijderen, verbergen, inactief zetten, drag-herordenen),
// maar de databron is de lokale, localStorage-backed demo-teamlijst
// (lib/demoTeamAdminStore.ts) i.p.v. Supabase. Geen upsertTeamMember/
// deleteTeamMember-calls, geen /api/team/invite of /api/team/delete,
// geen echte auth-accounts — invite-knoppen tonen een nep-succesmelding.
//
// TeamContext.tsx's demo-tak leest dezelfde 'yoko-demo-team-members'-key,
// dus elke wijziging hier (refresh() na een save) is meteen zichtbaar in
// Planning/Todo's/member-popups elders in de demo. De 'Bekijk als'-
// switcher in DemoShell blijft wel vast op de 4 originele DEMO_MEMBERS
// (zie rapport) — dat is een bewuste, kleine beperking.
import { useState, useRef } from 'react'
import { useTeam } from '@/components/TeamContext'
import type { TeamMember, TeamKind } from '@/lib/teamStore'
import { saveDemoTeamMembers } from '@/lib/demoTeamAdminStore'
import { IconUsers } from '@/components/Icon'

// Nep-invite: nooit een echte mail versturen of een Supabase auth-account
// aanmaken — laat alleen zien wat er in de echte app zou gebeuren.
function fakeSendInvite(email: string, name: string): void {
  window.alert(
    `Dit is een demo — er wordt geen echte mail verstuurd.\n\n` +
    `In de echte app zou nu een invite-mail naar ${email} zijn gegaan, ` +
    `zodat ${name} een wachtwoord kan zetten en kan inloggen.`,
  )
}

// Voorgestelde kleuren-set zodat een nieuwe gebruiker iets te kiezen heeft
// zonder de hele color-wheel uit te hoeven typen.
const PRESET_COLORS = [
  '#579bfc', '#9c7ee8', '#e2445c', '#00c875', '#ffcb00',
  '#ff7a00', '#a25ddc', '#26b3a4', '#ec6e8b', '#7a5af8',
  '#1e8a4e', '#d8b62e', '#c09bca', '#a07a4f', '#9aadbd',
]

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

type FilterKind = 'all' | 'yoko' | 'freelance' | 'unassigned' | 'hidden' | 'inactive'

export default function DemoTeamAdminPage() {
  const { allMembers: members, refresh } = useTeam()
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<FilterKind>('all')
  const dragFromRef = useRef<string | null>(null)
  const [draft, setDraft] = useState<TeamMember>({
    id: '', name: '', email: '', color: PRESET_COLORS[0], weeklyCapacity: 40, position: 999, hidden: false,
    kind: 'yoko',
    startDate: null,
    inactive: false,
  })

  // Persisteert de volledige lijst naar de demo-localStorage-key en trekt
  // 'm meteen weer terug de gedeelde TeamProvider in, zodat elke andere
  // useTeam()-consumer (Planning, Todo's, ...) 'm ook direct ziet.
  function persist(next: TeamMember[]) {
    saveDemoTeamMembers(next)
    refresh()
  }

  function saveNew() {
    if (!draft.name.trim()) return
    const id = draft.id || slugify(draft.name)
    if (!id) return
    if (members.some(m => m.id === id)) {
      alert('Er bestaat al een lid met deze id — kies een andere naam of zet handmatig een unieke id.')
      return
    }
    const pos = Math.max(0, ...members.map(m => m.position)) + 1
    const email = draft.email.trim()
    const newMember: TeamMember = { ...draft, id, position: pos, email }
    persist([...members, newMember])
    setAdding(false)
    // Zelfde volgorde als de echte pagina: bij een nieuw lid met email
    // 'gaat' er meteen een invite uit — in de demo is dat een nep-melding.
    if (email && draft.kind !== 'unassigned') {
      fakeSendInvite(email, draft.name)
    }
    setDraft({ id: '', name: '', email: '', color: PRESET_COLORS[0], weeklyCapacity: 40, position: 999, hidden: false, kind: 'yoko', startDate: null, inactive: false })
  }

  function updateField(id: string, patch: Partial<TeamMember>) {
    persist(members.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  function remove(id: string) {
    if (id === 'unassigned') { alert('"Unassigned" kun je niet verwijderen — die is een systeem-placeholder.'); return }
    const m = members.find(x => x.id === id)
    const name = m?.name ?? id
    if (!window.confirm(`'${name}' permanent verwijderen?\n\nLetop: bestaande items waar deze persoon aan toegewezen is verliezen hun owner.`)) return
    persist(members.filter(x => x.id !== id))
  }

  function toggleHidden(id: string) {
    const current = members.find(m => m.id === id)
    if (!current) return
    updateField(id, { hidden: !current.hidden })
  }

  // Inactief = gestopt (bv. stage afgerond) — blijft zichtbaar, telt niet
  // meer mee in actieve capaciteit. Los van hidden.
  function toggleInactive(id: string) {
    const current = members.find(m => m.id === id)
    if (!current) return
    updateField(id, { inactive: !current.inactive })
  }

  // Drop a member onto another: reorder + (eventueel) kind-overgang
  // wanneer je over een ander team-sectie heen sleept. Resterende leden
  // krijgen opnieuw oplopende position-indices zodat sortering schoon
  // blijft.
  function reorderDrop(fromId: string, targetId: string, targetKind: TeamKind) {
    if (fromId === targetId) return
    const from = members.find(m => m.id === fromId)
    const target = members.find(m => m.id === targetId)
    if (!from || !target) return

    const sorted = [...members].sort((a, b) => a.position - b.position)
    const without = sorted.filter(m => m.id !== fromId)
    const targetIdx = without.findIndex(m => m.id === targetId)
    if (targetIdx < 0) return
    // Insert het gesleepte item NA de target (klassieke 'drop after' gevoel).
    const reordered = [
      ...without.slice(0, targetIdx + 1),
      { ...from, kind: targetKind },
      ...without.slice(targetIdx + 1),
    ]
    persist(reordered.map((m, i) => ({ ...m, position: i })))
  }

  return (
    <Shell>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, maxWidth: 580, lineHeight: 1.5 }}>
          Voeg hier nieuwe teamleden toe of werk gegevens van bestaande leden bij. Bij een nieuw lid
          met email gaat automatisch een invite-mail uit — die persoon klikt de link, kiest een
          wachtwoord, en kan inloggen. Voor bestaande leden kun je met de <strong>✉ Invite</strong>
          knop opnieuw een login-link sturen.
          <br />
          <em>Dit is een demo: wijzigingen blijven lokaal in je browser en er wordt nooit echt gemaild.</em>
        </p>
        <button onClick={() => setAdding(a => !a)}
          style={{
            padding: '8px 14px', borderRadius: 7, border: 'none',
            background: adding ? 'var(--bg-hover)' : 'var(--accent)',
            color: adding ? 'var(--text-secondary)' : '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {adding ? 'Annuleren' : '+ Nieuw lid'}
        </button>
      </div>

      {adding && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Naam</label>
            <input value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value, id: d.id || slugify(e.target.value) }))}
              placeholder="Lisa de Vries"
              style={inputStyle} autoFocus />

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Id</label>
            <input value={draft.id}
              onChange={e => setDraft(d => ({ ...d, id: e.target.value }))}
              placeholder="lisa-de-vries"
              style={inputStyle} />

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Team</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['yoko', 'freelance'] as TeamKind[]).map(k => (
                <button key={k} onClick={() => setDraft(d => ({ ...d, kind: k }))}
                  style={{
                    padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                    background: draft.kind === k ? 'var(--accent)' : 'transparent',
                    color: draft.kind === k ? '#fff' : 'var(--text-secondary)',
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  }}>
                  {k === 'yoko' ? 'Studio Yoko' : 'Freelance'}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Email</label>
            <input value={draft.email}
              onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
              placeholder="lisa@studioyoko.nl"
              type="email"
              style={inputStyle} />

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Uren/week</label>
            <input value={String(draft.weeklyCapacity)}
              onChange={e => setDraft(d => ({ ...d, weeklyCapacity: parseFloat(e.target.value) || 0 }))}
              type="number" min={0} max={80} step={4}
              style={{ ...inputStyle, width: 100 }} />

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Startdatum</label>
            <div>
              <input value={draft.startDate ?? ''}
                onChange={e => setDraft(d => ({ ...d, startDate: e.target.value || null }))}
                type="date" style={{ ...inputStyle, width: 180 }} />
              <span style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>
                Automatisch zichtbaar vanaf deze dag
              </span>
            </div>

            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Kleur</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                  title={c}
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: draft.color === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                    background: c, cursor: 'pointer', padding: 0,
                  }} />
              ))}
              <input value={draft.color}
                onChange={e => setDraft(d => ({ ...d, color: e.target.value }))}
                placeholder="#hex"
                style={{ ...inputStyle, width: 100, fontFamily: 'monospace' }} />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setAdding(false)} style={btnSecondary}>Annuleren</button>
            <button onClick={saveNew} disabled={!draft.name.trim()} style={btnPrimary}>Toevoegen</button>
          </div>
        </div>
      )}

      {/* Filter-pills: snel switchen tussen team-groepen. Verberg-toggle
          per lid blijft beschikbaar; deze pills bepalen alleen welke
          secties in de tabel zichtbaar zijn. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          { id: 'all',         label: 'Alle leden' },
          { id: 'yoko',        label: 'Studio Yoko' },
          { id: 'freelance',   label: 'Freelance' },
          { id: 'unassigned',  label: 'Systeem' },
          { id: 'hidden',      label: 'Verborgen' },
          { id: 'inactive',    label: 'Inactief' },
        ] as { id: FilterKind; label: string }[]).map(p => {
          const active = filter === p.id
          return (
            <button key={p.id} onClick={() => setFilter(p.id)}
              style={{
                padding: '5px 12px', borderRadius: 999,
                border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                background: active ? 'var(--accent)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>{p.label}</button>
          )
        })}
      </div>

      {(() => {
        const sorted = [...members].sort((a, b) => a.position - b.position)
        const kindFilter = (m: TeamMember) =>
          filter === 'hidden' ? m.hidden : filter === 'inactive' ? m.inactive : !m.hidden
        const yoko       = sorted.filter(m => m.kind === 'yoko' && m.id !== 'unassigned' && kindFilter(m))
        const freelance  = sorted.filter(m => m.kind === 'freelance' && m.id !== 'unassigned' && kindFilter(m))
        const unassigned = sorted.filter(m => m.id === 'unassigned' || m.kind === 'unassigned')

        const showYoko       = filter === 'all' || filter === 'yoko'       || filter === 'hidden' || filter === 'inactive'
        const showFreelance  = filter === 'all' || filter === 'freelance'  || filter === 'hidden' || filter === 'inactive'
        const showSysteem    = filter === 'all' || filter === 'unassigned'

        const renderSection = (label: string, rows: TeamMember[], sectionKind: TeamKind) => rows.length === 0 ? null : (
          <div key={label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, padding: '0 2px' }}>{label} · {rows.length}</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 28px 1.1fr 1.3fr .8fr 80px 115px 95px 150px 80px 28px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                <span></span>
                <span></span>
                <span>Naam</span>
                <span>Email</span>
                <span>Id</span>
                <span>Uren/wk</span>
                <span>Start</span>
                <span>Team</span>
                <span>Status</span>
                <span>Login</span>
                <span></span>
              </div>
              {rows.map(m => (
                <Row key={m.id} member={m}
                  onChange={patch => updateField(m.id, patch)}
                  onDelete={() => remove(m.id)}
                  onToggleHidden={() => toggleHidden(m.id)}
                  onToggleInactive={() => toggleInactive(m.id)}
                  onDragStart={() => { dragFromRef.current = m.id }}
                  onDropOn={() => {
                    const from = dragFromRef.current
                    if (!from) return
                    dragFromRef.current = null
                    reorderDrop(from, m.id, sectionKind)
                  }}
                  onDragEnd={() => { dragFromRef.current = null }}
                />
              ))}
            </div>
          </div>
        )
        return (
          <>
            {showYoko       && renderSection('Studio Yoko', yoko,      'yoko')}
            {showFreelance  && renderSection('Freelance',   freelance, 'freelance')}
            {showSysteem    && renderSection('Systeem',     unassigned,'unassigned')}
          </>
        )
      })()}
    </Shell>
  )
}

function Row({ member, onChange, onDelete, onToggleHidden, onToggleInactive, onDragStart, onDropOn, onDragEnd }: {
  member: TeamMember
  onChange: (patch: Partial<TeamMember>) => void
  onDelete: () => void
  onToggleHidden: () => void
  onToggleInactive: () => void
  onDragStart?: () => void
  onDropOn?:    () => void
  onDragEnd?:   () => void
}) {
  const [dropHover, setDropHover] = useState(false)
  const draggable = member.id !== 'unassigned'
  const [name,  setName]  = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [hours, setHours] = useState(String(member.weeklyCapacity))

  function blurField<T>(key: keyof TeamMember, value: T, current: T) {
    if (value !== current) onChange({ [key]: value } as Partial<TeamMember>)
  }

  return (
    <div
      draggable={draggable}
      onDragStart={e => {
        if (!draggable || !onDragStart) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-yoko-team-member', member.id)
        onDragStart()
      }}
      onDragEnter={e => {
        if (!onDropOn) return
        if (!e.dataTransfer.types.includes('application/x-yoko-team-member')) return
        setDropHover(true)
      }}
      onDragOver={e => {
        if (!onDropOn) return
        if (!e.dataTransfer.types.includes('application/x-yoko-team-member')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={e => {
        setDropHover(false)
        if (!onDropOn) return
        e.preventDefault()
        onDropOn()
      }}
      onDragEnd={() => { setDropHover(false); onDragEnd?.() }}
      style={{ display: 'grid', gridTemplateColumns: '20px 28px 1.1fr 1.3fr .8fr 80px 115px 95px 150px 80px 28px', gap: 8, padding: '10px 14px', alignItems: 'center', opacity: member.hidden ? 0.55 : 1,
        borderBottom: dropHover ? '2px solid var(--accent)' : '1px solid var(--border-light)',
        background: dropHover ? 'var(--accent-light)' : 'transparent',
        cursor: draggable ? 'grab' : 'default',
        transition: 'background 0.1s' }}>
      <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, userSelect: 'none', textAlign: 'center' }}>⋮⋮</span>
      <button title="Kleur wijzigen"
        onClick={() => {
          const c = window.prompt('Hex-kleur (bv #579bfc):', member.color)
          if (c && /^#[0-9a-fA-F]{6}$/.test(c)) onChange({ color: c })
        }}
        style={{ width: 22, height: 22, borderRadius: '50%', background: member.color, border: '2px solid var(--border)', cursor: 'pointer', padding: 0 }} />
      <input value={name} onChange={e => setName(e.target.value)} onBlur={() => blurField('name', name, member.name)} style={cellInput} />
      <input value={email} onChange={e => setEmail(e.target.value)} onBlur={() => blurField('email', email, member.email)} type="email" style={cellInput} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{member.id}</span>
      <input value={hours} onChange={e => setHours(e.target.value)}
        onBlur={() => blurField('weeklyCapacity', parseFloat(hours) || 0, member.weeklyCapacity)}
        type="number" min={0} max={80} step={4}
        style={{ ...cellInput, width: 70 }} />
      <input value={member.startDate ?? ''} onChange={e => onChange({ startDate: e.target.value || null })}
        type="date" title="Vanaf deze dag automatisch zichtbaar in de planner"
        style={{ ...cellInput, fontSize: 11.5 }} />
      <select value={member.kind} disabled={member.id === 'unassigned'}
        onChange={e => onChange({ kind: e.target.value as TeamKind })}
        style={{ ...cellInput, padding: '4px 6px', cursor: member.id === 'unassigned' ? 'not-allowed' : 'pointer' }}>
        <option value="yoko">Studio Yoko</option>
        <option value="freelance">Freelance</option>
        <option value="unassigned">Systeem</option>
      </select>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button onClick={onToggleHidden}
          title={member.hidden ? 'Lid is verborgen — klik om weer zichtbaar te maken' : 'Lid is zichtbaar — klik om te verbergen (blijft bestaan)'}
          style={{
            padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
            background: member.hidden ? 'var(--bg-hover)' : 'transparent',
            color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
          {member.hidden ? '👁 Verborgen' : 'Zichtbaar'}
        </button>
        {member.id !== 'unassigned' && (
          <button onClick={onToggleInactive}
            title={member.inactive
              ? 'Lid is inactief (gestopt) — klik om weer actief te maken'
              : 'Lid telt mee in actieve capaciteit — klik om als inactief (gestopt) te markeren'}
            style={{
              padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
              background: member.inactive ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
            {member.inactive ? '💤 Inactief' : 'Actief'}
          </button>
        )}
      </div>
      <button
        onClick={() => {
          if (!member.email) { window.alert('Geen email-adres voor dit lid — vul eerst de email in.'); return }
          if (!window.confirm(`Invite versturen naar ${member.email}?\n\n${member.name} krijgt een mail met een link om een wachtwoord te zetten.`)) return
          fakeSendInvite(member.email, member.name)
        }}
        disabled={!member.email || member.id === 'unassigned'}
        title={!member.email ? 'Vul eerst een email-adres in' : `Stuur login-invite naar ${member.email}`}
        style={{
          padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)',
          background: member.email ? 'var(--bg-card)' : 'var(--bg-hover)',
          color: member.email ? 'var(--text-secondary)' : 'var(--text-muted)',
          fontSize: 11, fontWeight: 600,
          cursor: member.email && member.id !== 'unassigned' ? 'pointer' : 'not-allowed',
        }}>
        ✉ Invite
      </button>
      <button onClick={onDelete} title="Verwijderen" style={{ background: 'none', border: 'none', color: 'var(--red, #C9483D)', cursor: 'pointer', fontSize: 14 }}>×</button>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1100, padding: '40px 32px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 24px', display: 'flex', alignItems: 'center', gap: 10, letterSpacing: '-0.02em' }}>
        <IconUsers size={26} /> Team beheren
      </h1>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
}
const cellInput: React.CSSProperties = {
  background: 'transparent', border: '1px solid transparent', borderRadius: 5,
  padding: '4px 6px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: '100%',
}
const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 7, border: 'none',
  background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
