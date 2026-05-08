'use client'

export function VacationModal({ fromDraft, setFromDraft, untilDraft, setUntilDraft, canClear, onClose, onSave, onClear }: {
  fromDraft: string; setFromDraft: (v: string) => void
  untilDraft: string; setUntilDraft: (v: string) => void
  canClear: boolean
  onClose: () => void; onSave: () => void; onClear: () => void
}) {
  return (
    <>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 10001, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '20px 22px', width: 360, maxWidth: '92vw',
        boxShadow: '0 14px 40px rgba(0,0,0,0.35)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>🏝 Vakantie aanvragen</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Selecteer je periode. Weekend telt 0 uur, doordeweeks 8u/dag in de planning.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Vanaf
            <input type="date" value={fromDraft} autoFocus
              onChange={e => setFromDraft(e.target.value)}
              style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tot en met
            <input type="date" value={untilDraft}
              onChange={e => setUntilDraft(e.target.value)}
              style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canClear && (
            <button onClick={onClear}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Wissen
            </button>
          )}
          <button onClick={onClose}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Annuleer
          </button>
          <button onClick={onSave} disabled={!untilDraft}
            style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontSize: 13, fontWeight: 700, cursor: untilDraft ? 'pointer' : 'not-allowed', opacity: untilDraft ? 1 : 0.5 }}>
            Opslaan
          </button>
        </div>
      </div>
    </>
  )
}
