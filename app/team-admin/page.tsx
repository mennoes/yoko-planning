'use client'

import { useState } from 'react'
import { useTeam } from '@/components/TeamContext'
import { upsertTeamMember, deleteTeamMember, type TeamMember, type TeamKind } from '@/lib/teamStore'
import { useProfile } from '@/components/ProfileContext'
import { IconUsers } from '@/components/Icon'

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

export default function TeamAdminPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const { members, refresh } = useTeam()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<TeamMember>({
    id: '', name: '', email: '', color: PRESET_COLORS[0], weeklyCapacity: 40, position: 999, hidden: false,
    kind: 'yoko',
  })

  if (!authChecked) return <Shell><p style={{ color: 'var(--text-muted)' }}>Laden…</p></Shell>
  if (!isAuthenticated) return <Shell>
    <p style={{ color: 'var(--text-secondary)' }}>Log eerst in om teamleden te beheren.</p>
  </Shell>

  async function saveNew() {
    if (!draft.name.trim()) return
    const id = draft.id || slugify(draft.name)
    if (!id) return
    if (members.some(m => m.id === id)) {
      alert('Er bestaat al een lid met deze id — kies een andere naam of zet handmatig een unieke id.')
      return
    }
    const pos = Math.max(0, ...members.map(m => m.position)) + 1
    await upsertTeamMember({ ...draft, id, position: pos })
    await refresh()
    setAdding(false)
    setDraft({ id: '', name: '', email: '', color: PRESET_COLORS[0], weeklyCapacity: 40, position: 999, hidden: false, kind: 'yoko' })
  }

  async function updateField(id: string, patch: Partial<TeamMember>) {
    const current = members.find(m => m.id === id)
    if (!current) return
    await upsertTeamMember({ ...current, ...patch })
    await refresh()
  }

  async function remove(id: string) {
    if (id === 'unassigned') { alert('"Unassigned" kun je niet verwijderen — die is een systeem-placeholder.'); return }
    if (!window.confirm(`'${members.find(m => m.id === id)?.name ?? id}' permanent verwijderen?\n\nLetop: bestaande items waar deze persoon aan toegewezen is verliezen hun owner.`)) return
    await deleteTeamMember(id)
    await refresh()
  }

  async function toggleHidden(id: string) {
    const current = members.find(m => m.id === id)
    if (!current) return
    await upsertTeamMember({ ...current, hidden: !current.hidden })
    await refresh()
  }

  return (
    <Shell>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
          Hier voeg je nieuwe teamleden toe of werk je gegevens van bestaande leden bij. Wijzigingen syncen
          direct over alle apparaten. <strong>Een nieuw lid moet daarnaast ook een Supabase auth-account
          krijgen</strong> (Supabase dashboard → Authentication → Users → Add user) zodat ze kunnen inloggen.
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

      {(() => {
        const sorted = [...members].sort((a, b) => a.position - b.position)
        const yoko       = sorted.filter(m => m.kind === 'yoko' && m.id !== 'unassigned')
        const freelance  = sorted.filter(m => m.kind === 'freelance' && m.id !== 'unassigned')
        const unassigned = sorted.filter(m => m.id === 'unassigned' || m.kind === 'unassigned')
        const renderSection = (label: string, rows: TeamMember[]) => rows.length === 0 ? null : (
          <div key={label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, padding: '0 2px' }}>{label} · {rows.length}</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '32px 1.3fr 1.5fr 1fr 80px 110px 100px 28px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                <span></span>
                <span>Naam</span>
                <span>Email</span>
                <span>Id</span>
                <span>Uren/wk</span>
                <span>Team</span>
                <span>Status</span>
                <span></span>
              </div>
              {rows.map(m => (
                <Row key={m.id} member={m}
                  onChange={patch => updateField(m.id, patch)}
                  onDelete={() => remove(m.id)}
                  onToggleHidden={() => toggleHidden(m.id)} />
              ))}
            </div>
          </div>
        )
        return (
          <>
            {renderSection('Studio Yoko', yoko)}
            {renderSection('Freelance', freelance)}
            {renderSection('Systeem', unassigned)}
          </>
        )
      })()}
    </Shell>
  )
}

function Row({ member, onChange, onDelete, onToggleHidden }: {
  member: TeamMember
  onChange: (patch: Partial<TeamMember>) => void
  onDelete: () => void
  onToggleHidden: () => void
}) {
  const [name,  setName]  = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [hours, setHours] = useState(String(member.weeklyCapacity))

  function blurField<T>(key: keyof TeamMember, value: T, current: T) {
    if (value !== current) onChange({ [key]: value } as Partial<TeamMember>)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '32px 1.3fr 1.5fr 1fr 80px 110px 100px 28px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-light)', alignItems: 'center', opacity: member.hidden ? 0.55 : 1 }}>
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
      <select value={member.kind} disabled={member.id === 'unassigned'}
        onChange={e => onChange({ kind: e.target.value as TeamKind })}
        style={{ ...cellInput, padding: '4px 6px', cursor: member.id === 'unassigned' ? 'not-allowed' : 'pointer' }}>
        <option value="yoko">Studio Yoko</option>
        <option value="freelance">Freelance</option>
        <option value="unassigned">Systeem</option>
      </select>
      <button onClick={onToggleHidden}
        title={member.hidden ? 'Lid is verborgen — klik om weer zichtbaar te maken' : 'Lid is zichtbaar — klik om te verbergen (blijft bestaan)'}
        style={{
          padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
          background: member.hidden ? 'var(--bg-hover)' : 'transparent',
          color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
        {member.hidden ? '👁 Verborgen' : 'Zichtbaar'}
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
