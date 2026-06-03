'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconKey } from '@/components/Icon'
import { useProfile } from '@/components/ProfileContext'
import { useUndo } from '@/components/UndoContext'
import { requiresAuth, supabase } from '@/lib/supabase'
import { clearAuthCache } from '@/lib/sync'
import {
  pullAccounts, pullAccountsDetailed, upsertAccount, deleteAccount, subscribeRemoteAccounts,
  type Account,
} from '@/lib/accountsStore'

export default function AccountsPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const { showToast } = useUndo()
  const router = useRouter()
  const pathname = usePathname()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [authBlocked, setAuthBlocked] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<{ hasSession: boolean; email?: string | null; dbError?: string }>({ hasSession: false })
  const [retrying, setRetrying] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  function toggleReveal(id: string) {
    setRevealedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const [editingCell, setEditingCell] = useState<{ id: string; field: keyof Account } | null>(null)
  const [editValue, setEditValue] = useState('')

  // Authenticatie + initiële pull. We laten de gate aan de DATA-laag over:
  // pullAccounts probeert sowieso de query. RLS blokkeert anon-toegang
  // op database-niveau, dus een mislukte pull = niet-ingelogd of geen
  // toegang. Voordeel: de pagina werkt ook als isAuthenticated-state
  // hier-en-daar nog niet doorgekomen is (timing / localStorage-only
  // profile-cache) — zolang de Supabase-sessie geldig is, krijgt de
  // user de accounts. Lukt 't niet → nette lock-melding.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!requiresAuth) { setAuthBlocked(true); setLoading(false); return }
      if (!authChecked)  { setLoading(true); return }       // auth nog aan 't laden
      // Check de Supabase-sessie rechtstreeks, niet via de cache van
      // ProfileContext — die kan stale zijn. Zo zien we ook in welke
      // staat we hangen wanneer authBlocked uiteindelijk true wordt.
      let sessEmail: string | null | undefined
      let sessHas = false
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        sessHas = !!data.session
        sessEmail = data.session?.user?.email
      }
      clearAuthCache()
      const result = await pullAccountsDetailed()
      if (cancelled) return
      if (!result.rows) {
        setSessionInfo({
          hasSession: sessHas,
          email:      sessEmail,
          dbError:    result.error?.message
                      ? `${result.error.message}${result.error.code ? ` (${result.error.code})` : ''}`
                      : (result.noAuth ? 'geen geldige sessie gevonden bij Supabase' : undefined),
        })
        setAuthBlocked(true); setLoading(false); return
      }
      setSessionInfo({ hasSession: sessHas, email: sessEmail })
      setAuthBlocked(false)
      setAccounts(result.rows); setLoading(false)
    }
    load()
    const off = subscribeRemoteAccounts(() => {
      pullAccounts().then(rows => { if (rows && !cancelled) setAccounts(rows) })
    })
    return () => { cancelled = true; off() }
  }, [isAuthenticated, authChecked, retrying])

  async function retry() {
    if (!supabase) return
    setLoading(true)
    setRetrying(r => !r)  // dep flip → effect re-runs
    try {
      // Sessie pakken na een eventuele refresh — als de gebruiker net
      // een tab terug komt na inactiviteit kan dit 'm weer wakker maken.
      await supabase.auth.refreshSession()
    } catch {}
  }

  const startEdit = (account: Account, field: keyof Account) => {
    setEditingCell({ id: account.id, field })
    setEditValue(account[field])
  }

  const saveEdit = async () => {
    if (!editingCell) return
    const target = accounts.find(a => a.id === editingCell.id)
    if (!target) { setEditingCell(null); return }
    const updated = { ...target, [editingCell.field]: editValue }
    setAccounts(prev => prev.map(a => a.id === editingCell.id ? updated : a))
    setEditingCell(null)
    const idx = accounts.findIndex(a => a.id === editingCell.id)
    const ok = await upsertAccount(updated, idx)
    if (!ok) showToast('Opslaan mislukt — probeer opnieuw')
  }

  const addRow = async () => {
    const newId = Date.now().toString()
    const fresh: Account = { id: newId, account: 'Nieuw account', url: '', username: '', password: '', licensedBy: '' }
    const next = [...accounts, fresh]
    setAccounts(next)
    await upsertAccount(fresh, next.length - 1)
  }

  const deleteRow = async (id: string) => {
    setAccounts(prev => prev.filter(a => a.id !== id))
    await deleteAccount(id)
  }

  const columns: { key: keyof Account; label: string; width?: number }[] = [
    { key: 'account', label: 'Account', width: 260 },
    { key: 'url', label: 'URL', width: 200 },
    { key: 'username', label: 'Username', width: 270 },
    { key: 'password', label: 'Password', width: 280 },
    { key: 'licensedBy', label: 'License van', width: 150 },
  ]

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, padding: '48px 36px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 28px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconKey size={32} />Accounts
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Laden…</p>
      </div>
    )
  }

  if (authBlocked) {
    return (
      <div style={{ maxWidth: 1400, padding: '48px 36px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 28px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconKey size={32} />Accounts
        </h1>
        <div style={{ padding: '32px 28px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 16px' }}>
            🔒 De wachtwoorden zijn alleen zichtbaar voor ingelogde teamleden.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            Status: {sessionInfo.hasSession
              ? <>ingelogd als <strong>{sessionInfo.email}</strong>, maar de database wijst je af.</>
              : <>geen actieve sessie gevonden.</>}
          </p>
          {sessionInfo.dbError && (
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: 'var(--bg-base)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
              {sessionInfo.dbError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={retry}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
            >
              Probeer opnieuw
            </button>
            <button
              onClick={() => router.push(`/login?next=${encodeURIComponent(pathname || '/accounts')}`)}
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
            >
              Log in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1400, padding: '48px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconKey size={32} />Accounts
        </h1>
        <button
          onClick={() => setShowPasswords(!showPasswords)}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: showPasswords ? 'var(--accent)' : 'var(--bg-card)',
            color: showPasswords ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {showPasswords ? '🙈 Verberg' : '👁 Toon alles'}
        </button>
      </div>

      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns.map((c) => `${c.width || 150}px`).join(' ') + ' 40px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-hover)',
          }}
        >
          {columns.map((col) => (
            <div
              key={col.key}
              style={{
                padding: '14px 18px',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {col.label}
            </div>
          ))}
          <div />
        </div>

        {/* Rows */}
        {accounts.map((account, idx) => (
          <div
            key={account.id}
            style={{
              display: 'grid',
              gridTemplateColumns: columns.map((c) => `${c.width || 150}px`).join(' ') + ' 40px',
              borderBottom: idx < accounts.length - 1 ? '1px solid var(--border)' : 'none',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.querySelectorAll<HTMLElement>('.acct-eye').forEach(el => {
                if (el.style.opacity === '0') el.style.opacity = '0.85'
              })
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              const revealed = showPasswords || revealedIds.has(account.id)
              if (!revealed) {
                e.currentTarget.querySelectorAll<HTMLElement>('.acct-eye').forEach(el => {
                  el.style.opacity = '0'
                })
              }
            }}
          >
            {columns.map((col) => {
              const isEditing = editingCell?.id === account.id && editingCell?.field === col.key
              const value = account[col.key]
              const isUrl = col.key === 'url' && value

              return (
                <div
                  key={col.key}
                  style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', minHeight: 52 }}
                  onDoubleClick={() => startEdit(account, col.key)}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') setEditingCell(null)
                      }}
                      style={{
                        width: '100%',
                        background: 'var(--bg-base)',
                        border: '1px solid var(--accent)',
                        borderRadius: 4,
                        padding: '3px 7px',
                        color: 'var(--text-primary)',
                        fontSize: 15,
                        outline: 'none',
                      }}
                    />
                  ) : isUrl ? (
                    <a
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--blue)',
                        fontSize: 15,
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                      }}
                    >
                      {value}
                    </a>
                  ) : col.key === 'password' && value ? (() => {
                    const revealed = showPasswords || revealedIds.has(account.id)
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                        <span style={{
                          fontSize: 15, color: 'var(--text-secondary)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                        }}>
                          {revealed ? value : '••••••••••'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleReveal(account.id)
                          }}
                          title={revealed ? 'Verbergen' : 'Tonen'}
                          className="acct-eye"
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 5px', borderRadius: 4, flexShrink: 0, opacity: revealed ? 1 : 0, transition: 'opacity 0.12s' }}>
                          {revealed ? '👁' : '👁‍🗨'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard?.writeText(value)
                            const btn = e.currentTarget
                            const orig = btn.textContent
                            btn.textContent = '✓'
                            setTimeout(() => { btn.textContent = orig }, 1200)
                          }}
                          title="Kopieer wachtwoord"
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}>⧉</button>
                      </div>
                    )
                  })() : (
                    <span
                      style={{
                        fontSize: 15,
                        color: col.key === 'account' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: col.key === 'account' ? 500 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {value || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Delete button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button
                onClick={() => deleteRow(account.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 4,
                  borderRadius: 4,
                  lineHeight: 1,
                  opacity: 0,
                  transition: 'opacity 0.15s',
                }}
                className="delete-btn"
                aria-label="Delete row"
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {/* Add row */}
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            onClick={addRow}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            + Voeg account toe
          </button>
        </div>
      </div>

      <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
        Wachtwoorden staan in Supabase achter login (RLS). Dubbelklik op een cel om te bewerken.
      </p>

      <style>{`
        div:hover .delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
