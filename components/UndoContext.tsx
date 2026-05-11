'use client'

import { createContext, useContext, useRef, useEffect, useState, type ReactNode } from 'react'

type UndoFn = () => void
type UndoEntry = { fn: UndoFn; description?: string }
type UndoCtx = { pushUndo: (fn: UndoFn, description?: string) => void; clearUndo: () => void }

const Ctx = createContext<UndoCtx>({ pushUndo: () => {}, clearUndo: () => {} })

export function UndoProvider({ children }: { children: ReactNode }) {
  const stack = useRef<UndoEntry[]>([])
  const [toast, setToast] = useState<{ id: number; description: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function pushUndo(fn: UndoFn, description?: string) {
    stack.current = [...stack.current.slice(-49), { fn, description }]
    if (description) {
      const id = Date.now()
      setToast({ id, description })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 5000)
    }
  }

  function clearUndo() { stack.current = [] }

  function undoLast() {
    const entry = stack.current.pop()
    if (entry) entry.fn()
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Negeer als de gebruiker in een input/textarea staat — daar
        // hoort Cmd+Z bij de standaard text-undo van de browser.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        const entry = stack.current.pop()
        if (entry) { e.preventDefault(); entry.fn() }
        if (toastTimer.current) clearTimeout(toastTimer.current)
        setToast(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <Ctx.Provider value={{ pushUndo, clearUndo }}>
      {children}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9500,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
          fontSize: 13, color: 'var(--text-primary)',
          maxWidth: '92vw',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.description}</span>
          <button onClick={undoLast}
            style={{
              background: 'var(--accent)', color: '#000',
              border: 'none', borderRadius: 6, padding: '5px 11px',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            ↶ Maak ongedaan
          </button>
          <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 4px' }}>
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}

export const useUndo = () => useContext(Ctx)
