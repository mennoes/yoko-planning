'use client'

import { useState, useRef, useEffect } from 'react'
import { useTeam } from '@/components/TeamContext'
import { upsertTeamMember, deleteTeamMember, type TeamMember, type TeamKind } from '@/lib/teamStore'
import { useProfile } from '@/components/ProfileContext'
import { supabase } from '@/lib/supabase'
import { IconUsers } from '@/components/Icon'

// Resultaat van een invite-poging. Wordt via een window-event naar de
// InviteResultDialog op pagina-niveau gestuurd (sendInvite wordt vanuit
// twee verschillende componenten aangeroepen, dus een event is simpeler
// dan de state door beide bomen te prop-drillen).
export type InviteResult = { title: string; body: string; link?: string | null; ok: boolean }
const INVITE_RESULT_EVENT = 'yoko-invite-result'

function reportInvite(result: InviteResult): void {
  window.dispatchEvent(new CustomEvent<InviteResult>(INVITE_RESULT_EVENT, { detail: result }))
}

// Stuur invite naar de geconfigureerde Supabase auth — maakt user aan
// (of stuurt magic-link als-ie al bestaat) zodat 'ie kan inloggen.
async function sendInvite(email: string, name: string): Promise<void> {
  if (!supabase) { reportInvite({ ok: false, title: 'Niet geconfigureerd', body: 'Supabase niet geconfigureerd.' }); return }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) { reportInvite({ ok: false, title: 'Niet ingelogd', body: 'Log opnieuw in en probeer het dan nog eens.' }); return }
  try {
    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    })
    const json = await res.json() as { ok: boolean; status?: string; error?: string; actionLink?: string }
    if (!json.ok) {
      const raw = json.error ?? 'onbekende fout'
      reportInvite(raw.toLowerCase().includes('rate limit')
        ? { ok: false, title: 'Mailserver-limiet bereikt',
            body: 'Er zijn te veel auth-mails in korte tijd verstuurd. Wacht een uur en probeer opnieuw, '
              + 'of stel een eigen SMTP-server in bij Supabase → Authentication → SMTP Settings om deze limiet weg te nemen.' }
        : { ok: false, title: 'Invite mislukt', body: raw })
      return
    }
    if (json.status === 'invited') {
      reportInvite({ ok: true, title: 'Invite verstuurd',
        body: `${name} krijgt een mail op ${email} met een link om een wachtwoord te zetten.` })
    } else if (json.status === 'invited_no_mail') {
      // Account is aangemaakt, alleen de mail kwam er niet uit (meestal de
      // rate-limit van Supabase's ingebouwde mailer). De link werkt gewoon —
      // stuur 'm handmatig door via Slack/WhatsApp.
      reportInvite({ ok: true, title: 'Account aangemaakt — mail niet verstuurd',
        body: `Het account voor ${email} bestaat nu, maar de mail kon niet verstuurd worden `
          + `(${json.error ?? 'mailserver-limiet'}). Stuur ${name} onderstaande login-link handmatig door.`,
        link: json.actionLink })
    } else if (json.status === 'exists') {
      reportInvite({ ok: true, title: 'Bestaand account — nieuwe login-link',
        body: json.actionLink
          ? `${email} had al een account. Stuur onderstaande magic-link door zodat ${name} weer in kan loggen.`
          : `${email} had al een account. Er is een nieuwe magic-link verstuurd via Supabase SMTP.`,
        link: json.actionLink })
    }
  } catch (e) {
    reportInvite({ ok: false, title: 'Invite-call mislukt', body: String(e) })
  }
}

// Dialog met een SELECTEERBAAR linkveld — een window.alert() laat je de
// tekst niet selecteren, waardoor een handmatig door te sturen login-link
// onbruikbaar was.
function InviteResultDialog() {
  const [result, setResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onResult(e: Event) {
      setResult((e as CustomEvent<InviteResult>).detail)
      setCopied(false)
    }
    window.addEventListener(INVITE_RESULT_EVENT, onResult)
    return () => window.removeEventListener(INVITE_RESULT_EVENT, onResult)
  }, [])

  // Link meteen geselecteerd tonen zodat Cmd+C direct werkt, ook als de
  // clipboard-API geblokkeerd is (bv. zonder https of in een iframe).
  useEffect(() => {
    if (result?.link) setTimeout(() => inputRef.current?.select(), 50)
  }, [result])

  if (!result) return null

  async function copy() {
    if (!result?.link) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    } catch {
      inputRef.current?.select()
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) setResult(null) }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '22px 24px', width: 560, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
          {result.ok ? '' : '⚠️ '}{result.title}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {result.body}
        </p>

        {result.link && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={inputRef} readOnly value={result.link}
                onClick={e => e.currentTarget.select()}
                style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-hover)',
                  color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
              <button onClick={copy}
                style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 8, border: 'none',
                  background: copied ? 'var(--green, #00c875)' : 'var(--accent)', color: '#000',
                  fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {copied ? '✓ Gekopieerd' : 'Kopieer'}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Deze link is eenmalig en verloopt — stuur &apos;m meteen door via Slack of WhatsApp.
            </p>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={() => setResult(null)}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Sluiten
          </button>
        </div>
      </div>
    </div>
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

export default function TeamAdminPage() {
  const { isAuthenticated, authChecked } = useProfile()
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
    const email = draft.email.trim()
    const res = await upsertTeamMember({ ...draft, id, position: pos, email })
    if (!res.ok) {
      alert(
        `Toevoegen mislukt: ${res.error}\n\n` +
        `Vaakste oorzaak: een Supabase migratie staat nog niet — run\n` +
        `supabase/0017_team_members.sql + 0018_team_members_kind.sql\n` +
        `in Supabase → SQL Editor.`,
      )
      return
    }
    if (res.error === 'kind_column_missing_run_0018') {
      alert(
        `Lid toegevoegd, maar de 'kind' kolom mist nog. Run\n` +
        `supabase/0018_team_members_kind.sql in Supabase SQL Editor\n` +
        `om de Studio Yoko / Freelance-indeling op te slaan.`,
      )
    }
    await refresh()
    setAdding(false)
    // Direct ook een Supabase auth-invite versturen zodat de nieuwe persoon
    // meteen kan inloggen, zonder dat de admin nog naar het Supabase
    // dashboard hoeft. Alleen wanneer er een email staat én 't lid niet
    // 'systeem' is.
    if (email && draft.kind !== 'unassigned') {
      sendInvite(email, draft.name).catch(() => {})
    }
    setDraft({ id: '', name: '', email: '', color: PRESET_COLORS[0], weeklyCapacity: 40, position: 999, hidden: false, kind: 'yoko', startDate: null, inactive: false })
  }

  async function updateField(id: string, patch: Partial<TeamMember>) {
    const current = members.find(m => m.id === id)
    if (!current) return
    const res = await upsertTeamMember({ ...current, ...patch })
    if (!res.ok) { alert(`Opslaan mislukt: ${res.error}`); return }
    await refresh()
  }

  async function remove(id: string) {
    if (id === 'unassigned') { alert('"Unassigned" kun je niet verwijderen — die is een systeem-placeholder.'); return }
    const m = members.find(x => x.id === id)
    const name = m?.name ?? id
    if (!window.confirm(`'${name}' permanent verwijderen?\n\nLetop: bestaande items waar deze persoon aan toegewezen is verliezen hun owner.`)) return
    // Vraag of de Supabase auth-account óók opgeruimd moet worden zodat
    // een re-invite vers van start gaat. Default: ja als er een email is.
    let alsoAuth = false
    if (m?.email) {
      alsoAuth = window.confirm(
        `Wil je óók het Supabase auth-account voor ${m.email} verwijderen?\n\n` +
        `Met JA: schone re-invite mogelijk. Met NEE: account blijft bestaan, ` +
        `bij een nieuwe invite krijgt deze gebruiker een magic-link i.p.v. een welkomstmail.`,
      )
    }
    if (alsoAuth && m?.email) {
      try {
        const sess = await supabase?.auth.getSession()
        const token = sess?.data.session?.access_token
        if (token) {
          await fetch('/api/team/delete', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, email: m.email, deleteAuth: true }),
          })
        } else {
          await deleteTeamMember(id)
        }
      } catch {
        await deleteTeamMember(id)
      }
    } else {
      await deleteTeamMember(id)
    }
    await refresh()
  }

  async function toggleHidden(id: string) {
    const current = members.find(m => m.id === id)
    if (!current) return
    const res = await upsertTeamMember({ ...current, hidden: !current.hidden })
    if (!res.ok) { alert(`Wijzigen mislukt: ${res.error}`); return }
    await refresh()
  }

  // Inactief = gestopt (bv. stage afgerond) — blijft zichtbaar, telt niet
  // meer mee in actieve capaciteit (Planning groepeert 'm apart). Los van
  // hidden: een inactief lid blijft gewoon zichtbaar in Team/Planning.
  async function toggleInactive(id: string) {
    const current = members.find(m => m.id === id)
    if (!current) return
    const res = await upsertTeamMember({ ...current, inactive: !current.inactive })
    if (!res.ok) { alert(`Wijzigen mislukt: ${res.error}`); return }
    if (res.error === 'inactive_column_missing_run_0037') {
      alert(`Opgeslagen, maar de 'inactive' kolom mist nog. Run supabase/0037_team_member_inactive.sql in Supabase → SQL Editor om dit blijvend te bewaren.`)
    }
    await refresh()
  }

  // Drop a member onto another: reorder + (eventueel) kind-overgang
  // wanneer je over een ander team-sectie heen sleept. Resterende leden
  // krijgen opnieuw oplopende position-indices zodat sortering schoon
  // blijft. Pusht alle gewijzigde rijen parallel.
  async function reorderDrop(fromId: string, targetId: string, targetKind: TeamKind) {
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
    // Verzamel alle leden waarvan position of kind veranderd is, push parallel.
    const updates = reordered
      .map((m, i) => ({ ...m, position: i }))
      .filter((m, i) => {
        const original = members.find(o => o.id === m.id)
        if (!original) return true
        return original.position !== i || original.kind !== m.kind
      })
    await Promise.all(updates.map(u => upsertTeamMember(u)))
    await refresh()
  }

  return (
    <Shell>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, maxWidth: 580, lineHeight: 1.5 }}>
          Voeg hier nieuwe teamleden toe of werk gegevens van bestaande leden bij. Bij een nieuw lid
          met email gaat automatisch een invite-mail uit — die persoon klikt de link, kiest een
          wachtwoord, en kan inloggen. Voor bestaande leden kun je met de <strong>✉ Invite</strong>
          knop opnieuw een login-link sturen.
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
          sendInvite(member.email, member.name)
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
      {/* Eén gedeelde dialog voor alle invite-resultaten — sendInvite wordt
          vanuit zowel het 'nieuw lid'-formulier als de ✉ Invite-knop per rij
          aangeroepen en meldt z'n resultaat via een window-event. */}
      <InviteResultDialog />
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
