'use client'

// DEMO-VARIANT van app/accounts/page.tsx — zelfde UI/interactiepatroon
// (reveal/hide, copy-to-clipboard, inline edit, add/delete), maar
// volledig losgekoppeld van de echte databron. Dit bestand mag NOOIT
// iets uit lib/accountsStore.ts importeren en NOOIT rechtstreeks
// `supabase.from('accounts')` aanroepen — de echte tabel bevat plaintext
// wachtwoorden voor Studio Yoko's eigen tool-abonnementen. In plaats
// daarvan werkt deze pagina uitsluitend tegen lib/demoAccountsStore.ts,
// een lokale (localStorage-only) store gevuld met verzonnen fixtures.
//
// De echte pagina gate't op auth (requiresAuth/Supabase-sessie) — hier
// niet nodig: de demo-omgeving is altijd publiek en "ingelogd" per
// ProfileContext's demo-branch, dus we tonen de tabel meteen.
import { useState, useEffect } from 'react'
import { IconKey, IconEye, IconEyeOff, IconCopy, IconCheck } from '@/components/Icon'
import {
  loadAccounts, saveAccounts, onAccountsUpdate,
  type DemoAccount as Account,
} from '@/lib/demoAccountsStore'

export default function DemoAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
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

  useEffect(() => {
    setAccounts(loadAccounts())
    return onAccountsUpdate(() => setAccounts(loadAccounts()))
  }, [])

  const startEdit = (account: Account, field: keyof Account) => {
    setEditingCell({ id: account.id, field })
    setEditValue(account[field])
  }

  const saveEdit = () => {
    if (!editingCell) return
    const target = accounts.find(a => a.id === editingCell.id)
    if (!target) { setEditingCell(null); return }
    const updated = { ...target, [editingCell.field]: editValue }
    const next = accounts.map(a => a.id === editingCell.id ? updated : a)
    setAccounts(next)
    saveAccounts(next)
    setEditingCell(null)
  }

  const addRow = () => {
    const newId = Date.now().toString()
    const fresh: Account = { id: newId, account: 'Nieuw account (demo)', url: '', username: '', password: '', licensedBy: '' }
    const next = [...accounts, fresh]
    setAccounts(next)
    saveAccounts(next)
  }

  const deleteRow = (id: string) => {
    const next = accounts.filter(a => a.id !== id)
    setAccounts(next)
    saveAccounts(next)
  }

  const columns: { key: keyof Account; label: string; width?: number }[] = [
    { key: 'account', label: 'Account', width: 260 },
    { key: 'url', label: 'URL', width: 200 },
    { key: 'username', label: 'Username', width: 270 },
    { key: 'password', label: 'Password', width: 280 },
    { key: 'licensedBy', label: 'License van', width: 150 },
  ]

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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {showPasswords ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            {showPasswords ? 'Verberg' : 'Toon alles'}
          </span>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--blue)',
                          fontSize: 15,
                          textDecoration: 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1, minWidth: 0,
                        }}
                      >
                        {value}
                      </a>
                      <CopyButton text={value} title="Kopieer URL" />
                    </div>
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
                          {revealed ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                        </button>
                        <CopyButton text={value} title="Kopieer wachtwoord" />
                      </div>
                    )
                  })() : value ? (
                    <CopyableText value={value}
                      bold={col.key === 'account'}
                      title={`Klik om '${col.label.toLowerCase()}' te kopiëren`} />
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 15 }}>—</span>
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
        Klik op een cel om de waarde te kopiëren · dubbelklik om te bewerken · dit is demo-data, lokaal in je browser opgeslagen.
      </p>

      <style>{`
        div:hover .delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

// ─── Click-to-copy helpers ────────────────────────────────────────────────────
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title={title}
      style={{
        background: 'none', border: 'none',
        color: copied ? 'var(--green, #00c875)' : 'var(--text-muted)',
        cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 4, flexShrink: 0,
        transition: 'color 0.12s',
      }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-muted)' }}>
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  )
}

// CopyableText — hele cel-tekst is een knop die kopieert. Visueel onzichtbaar
// (geen border, geen achtergrond) maar geeft een korte ✓ tooltip bij klik en
// hover-cursor zodat 't duidelijk is dat 'ie klikbaar is. Dubbelklik blijft
// werken voor edit-mode via de cel-onDoubleClick handler.
function CopyableText({ value, bold, title }: { value: string; bold?: boolean; title: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title={copied ? 'Gekopieerd ✓' : title}
      style={{
        fontSize: 15,
        color: copied ? 'var(--green, #00c875)' : (bold ? 'var(--text-primary)' : 'var(--text-secondary)'),
        fontWeight: bold ? 500 : 400,
        cursor: 'copy',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        userSelect: 'text',
        transition: 'color 0.12s',
      }}>
      {value}
    </span>
  )
}
