'use client'

import { useState } from 'react'
import initialData from '@/data/accounts.json'

type Account = {
  id: string
  account: string
  url: string
  username: string
  licensedBy: string
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>(initialData.accounts)
  const [showPasswords, setShowPasswords] = useState(false)
  const [editingCell, setEditingCell] = useState<{ id: string; field: keyof Account } | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (account: Account, field: keyof Account) => {
    setEditingCell({ id: account.id, field })
    setEditValue(account[field])
  }

  const saveEdit = () => {
    if (!editingCell) return
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === editingCell.id ? { ...a, [editingCell.field]: editValue } : a
      )
    )
    setEditingCell(null)
  }

  const addRow = () => {
    const newId = Date.now().toString()
    setAccounts((prev) => [
      ...prev,
      { id: newId, account: 'Nieuw account', url: '', username: '', licensedBy: '' },
    ])
  }

  const deleteRow = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const columns: { key: keyof Account; label: string; width?: number }[] = [
    { key: 'account', label: 'Account', width: 200 },
    { key: 'url', label: 'URL', width: 180 },
    { key: 'username', label: 'Username', width: 220 },
    { key: 'licensedBy', label: 'License van', width: 130 },
  ]

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          🔑 Accounts
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
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 600,
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
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {columns.map((col) => {
              const isEditing = editingCell?.id === account.id && editingCell?.field === col.key
              const value = account[col.key]
              const isUrl = col.key === 'url' && value

              return (
                <div
                  key={col.key}
                  style={{ padding: '9px 14px', display: 'flex', alignItems: 'center' }}
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
                        fontSize: 13.5,
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
                        fontSize: 13.5,
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                      }}
                    >
                      {value}
                    </a>
                  ) : (
                    <span
                      style={{
                        fontSize: 13.5,
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
        Dubbelklik op een cel om te bewerken.
      </p>

      <style>{`
        div:hover .delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
