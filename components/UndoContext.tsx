'use client'

import { createContext, useContext, useRef, useEffect, type ReactNode } from 'react'

type UndoFn = () => void
type UndoCtx = { pushUndo: (fn: UndoFn) => void; clearUndo: () => void }

const Ctx = createContext<UndoCtx>({ pushUndo: () => {}, clearUndo: () => {} })

export function UndoProvider({ children }: { children: ReactNode }) {
  const stack = useRef<UndoFn[]>([])

  function pushUndo(fn: UndoFn) {
    stack.current = [...stack.current.slice(-49), fn]
  }

  function clearUndo() {
    stack.current = []
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const fn = stack.current.pop()
        if (fn) { e.preventDefault(); fn() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <Ctx.Provider value={{ pushUndo, clearUndo }}>{children}</Ctx.Provider>
}

export const useUndo = () => useContext(Ctx)
