'use client'

import { useState, useEffect } from 'react'
import { IconBuilding } from '@/components/Icon'

// ─── Data types ───────────────────────────────────────────────────────────────
type InfoRowData   = { id: string; label: string; value: string; mono?: boolean; secret?: boolean }
type InfoBlockData = { id: string; label: string; rows?: InfoRowData[]; text?: string }
type SectionData   = { id: string; title: string; emoji: string; blocks: InfoBlockData[] }

const DEFAULT_DATA: SectionData[] = [
  {
    id: 'amsterdam', title: 'Amsterdam', emoji: '📍',
    blocks: [
      { id: 'adres', label: 'Adres', text: 'yoko B.V.\nKattenburgerstraat 5, gebouw 027E, 2e etage\n1018JA Amsterdam' },
      { id: 'bedrijf', label: 'Bedrijfsgegevens', rows: [
        { id: 'kvk',  label: 'KvK',      value: '81125828' },
        { id: 'iban', label: 'IBAN',      value: 'NL08 INGB 0006 7601 94', mono: true },
        { id: 'bic',  label: 'SWIFT/BIC', value: 'INGBNL2A',               mono: true },
        { id: 'btw',  label: 'BTW',       value: 'NL861942930B01',         mono: true },
      ]},
      { id: 'wifi-ams', label: 'WiFi', rows: [
        { id: 'net1',  label: 'Netwerk',    value: 'HetKantoor' },
        { id: 'pass1', label: 'Wachtwoord', value: 'fyHJWKiKFTZP9q-8rwDQ', mono: true, secret: true },
      ]},
      { id: 'park-ams', label: 'Parkeren', text: 'Reserveer je plek via de parkeerapp.\nLogin: menno@studioyoko.nl' },
    ],
  },
  {
    id: 'utrecht', title: 'Utrecht', emoji: '📍',
    blocks: [
      { id: 'adres-utr', label: 'Adres', text: 'Hooghiemstraplein 158\n3514 AZ Utrecht' },
      { id: 'wifi-utr', label: 'WiFi', rows: [
        { id: 'net2',  label: 'Netwerk',    value: 'WiFi_Animatietuin1' },
        { id: 'pass2', label: 'Wachtwoord', value: 'F90D30DD', mono: true, secret: true },
      ]},
      { id: 'alarm', label: 'Alarm', rows: [
        { id: 'code', label: 'Alarmcode', value: '3334',       mono: true, secret: true },
        { id: 'tel',  label: 'Securitas', value: '040 028 41 62' },
        { id: 'id',   label: 'ID code',   value: '274406#',    mono: true, secret: true },
      ]},
      { id: 'park-utr', label: 'Parkeren', text: 'Parkeergarage De Grifthoek' },
    ],
  },
]

const STORAGE_KEY = 'yoko-kantoor'
function genId()  { return Math.random().toString(36).slice(2, 9) }

// ─── Inline-editable text ─────────────────────────────────────────────────────
function EditableText({
  value, onSave, multiline = false, style, placeholder,
}: {
  value: string; onSave: (v: string) => void
  multiline?: boolean; style?: React.CSSProperties; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  function commit() { onSave(draft.trim() || value); setEditing(false) }

  if (editing) {
    if (multiline) return (
      <textarea autoFocus value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        rows={Math.max(2, draft.split('\n').length)}
        style={{
          width: '100%', background: 'var(--bg-base)', border: '1px solid var(--accent)',
          borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)',
          fontSize: 13, outline: 'none', resize: 'vertical',
          boxSizing: 'border-box', lineHeight: 1.6, ...style,
        }} />
    )
    return (
      <input autoFocus value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        style={{
          background: 'var(--bg-base)', border: '1px solid var(--accent)',
          borderRadius: 4, padding: '2px 7px', color: 'var(--text-primary)',
          fontSize: 13, outline: 'none', boxSizing: 'border-box', ...style,
        }} />
    )
  }

  return (
    <span onClick={() => { setDraft(value); setEditing(true) }}
      title="Klik om te bewerken"
      style={{ cursor: 'text', whiteSpace: 'pre-line', ...style }}>
      {value || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{placeholder ?? '—'}</span>}
    </span>
  )
}

// ─── Info row ─────────────────────────────────────────────────────────────────
function InfoRowComp({ row, onUpdate, onDelete }: {
  row: InfoRowData; onUpdate: (r: InfoRowData) => void; onDelete: () => void
}) {
  const [hover,    setHover]    = useState(false)
  const [revealed, setRevealed] = useState(false)

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, position: 'relative' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <EditableText value={row.label} onSave={v => onUpdate({ ...row, label: v })}
        style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 90, flexShrink: 0 }} placeholder="Label" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
        {row.secret && !revealed ? (
          <button onClick={() => setRevealed(true)} style={{
            fontSize: 13, color: 'var(--text-secondary)', background: 'var(--overlay-medium)',
            border: 'none', borderRadius: 4, padding: '1px 8px', cursor: 'pointer',
            fontFamily: row.mono ? 'monospace' : undefined, letterSpacing: '0.15em',
          }}>••••••••</button>
        ) : (
          <EditableText value={row.value} onSave={v => onUpdate({ ...row, value: v })}
            style={{
              fontSize: 13, color: 'var(--text-secondary)',
              fontFamily: row.mono ? 'monospace' : undefined,
              letterSpacing: row.mono ? '0.03em' : undefined,
            }} placeholder="Waarde" />
        )}
        {row.secret && revealed && (
          <button onClick={() => setRevealed(false)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', padding: 0,
          }}>verberg</button>
        )}
      </div>
      {hover && (
        <div style={{ display: 'flex', gap: 3, position: 'absolute', right: 0, top: -2, background: 'var(--bg-card)', borderRadius: 4, padding: '1px 2px' }}>
          <button onClick={() => onUpdate({ ...row, secret: !row.secret })} title={row.secret ? 'Maak zichtbaar' : 'Verberg'} style={iconBtn}>{row.secret ? '👁' : '🔒'}</button>
          <button onClick={() => onUpdate({ ...row, mono: !row.mono })} title="Monospace" style={{ ...iconBtn, fontFamily: 'monospace', fontWeight: row.mono ? 700 : 400, color: row.mono ? 'var(--text-primary)' : 'var(--text-muted)' }}>M</button>
          <button onClick={onDelete} title="Verwijderen" style={iconBtn}
            onMouseEnter={e => (e.currentTarget.style.color = '#e2445c')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
        </div>
      )}
    </div>
  )
}

// ─── Info block ───────────────────────────────────────────────────────────────
function InfoBlockComp({ block, onUpdate, onDelete }: {
  block: InfoBlockData; onUpdate: (b: InfoBlockData) => void; onDelete: () => void
}) {
  const [hover, setHover] = useState(false)

  function updateRow(id: string, r: InfoRowData) { onUpdate({ ...block, rows: (block.rows ?? []).map(x => x.id === id ? r : x) }) }
  function deleteRow(id: string)                 { onUpdate({ ...block, rows: (block.rows ?? []).filter(x => x.id !== id) }) }
  function addRow()    { onUpdate({ ...block, rows: [...(block.rows ?? []), { id: genId(), label: 'Label', value: '' }] }) }
  function toggleMode() {
    if (block.rows) onUpdate({ ...block, rows: undefined, text: block.rows.map(r => `${r.label}: ${r.value}`).join('\n') })
    else onUpdate({ ...block, rows: [], text: undefined })
  }

  return (
    <div style={{ marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ padding: '7px 14px', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <EditableText value={block.label} onSave={v => onUpdate({ ...block, label: v })}
          style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }} />
        {hover && (
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={toggleMode} title={block.rows ? 'Naar vrije tekst' : 'Naar rijen'} style={iconBtn}>{block.rows ? '¶' : '☰'}</button>
            {block.rows && <button onClick={addRow} title="Rij toevoegen" style={iconBtn}>+</button>}
            <button onClick={onDelete} title="Blok verwijderen" style={iconBtn}
              onMouseEnter={e => (e.currentTarget.style.color = '#e2445c')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px' }}>
        {block.rows ? (
          block.rows.map(row => (
            <InfoRowComp key={row.id} row={row} onUpdate={r => updateRow(row.id, r)} onDelete={() => deleteRow(row.id)} />
          ))
        ) : (
          <EditableText value={block.text ?? ''} onSave={v => onUpdate({ ...block, text: v })}
            multiline style={{ fontSize: 13, color: 'var(--text-secondary)' }} placeholder="Tekst…" />
        )}
      </div>
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
function SectionComp({ section, onUpdate, onDelete }: {
  section: SectionData; onUpdate: (s: SectionData) => void; onDelete: () => void
}) {
  function updateBlock(id: string, b: InfoBlockData) { onUpdate({ ...section, blocks: section.blocks.map(x => x.id === id ? b : x) }) }
  function deleteBlock(id: string)                   { onUpdate({ ...section, blocks: section.blocks.filter(x => x.id !== id) }) }
  function addBlock() { onUpdate({ ...section, blocks: [...section.blocks, { id: genId(), label: 'Nieuw blok', rows: [] }] }) }

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ margin: '0 0 16px', paddingBottom: 10, borderBottom: '2px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <EditableText value={section.emoji} onSave={v => onUpdate({ ...section, emoji: v })} style={{ fontSize: 20 }} />
        <EditableText value={section.title} onSave={v => onUpdate({ ...section, title: v })}
          style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }} />
        <button onClick={addBlock} style={{ ...iconBtn, fontSize: 13 }}>+ blok</button>
        <button onClick={onDelete} style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.color = '#e2445c')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>×</button>
      </div>
      {section.blocks.map(b => (
        <InfoBlockComp key={b.id} block={b} onUpdate={u => updateBlock(b.id, u)} onDelete={() => deleteBlock(b.id)} />
      ))}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function KantoorPage() {
  const [sections, setSections] = useState<SectionData[]>([])
  const [loaded,   setLoaded]   = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setSections(raw ? JSON.parse(raw) : DEFAULT_DATA)
    } catch { setSections(DEFAULT_DATA) }
    setLoaded(true)
  }, [])

  function update(updated: SectionData[]) {
    setSections(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  if (!loaded) return null

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconBuilding size={26} />Kantoor
        </h1>
        <button onClick={() => update([...sections, { id: genId(), title: 'Nieuwe locatie', emoji: '📍', blocks: [] }])}
          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          + Locatie
        </button>
      </div>
      {sections.map(s => (
        <SectionComp key={s.id} section={s}
          onUpdate={u => update(sections.map(x => x.id === s.id ? u : x))}
          onDelete={() => update(sections.filter(x => x.id !== s.id))} />
      ))}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        Klik op tekst om te bewerken · 🔒 verbergen · + toevoegen
      </p>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: 12, padding: '2px 5px', borderRadius: 3,
}
