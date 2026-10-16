'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { subscribeBoardSaveStatus, type BoardSaveStatus } from '@/lib/boardSaveStatus'

export default function BoardSaveIndicator() {
  const [status, setStatus] = useState<BoardSaveStatus | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => subscribeBoardSaveStatus(next => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setStatus(next)
    if (next.state === 'saved') {
      hideTimer.current = setTimeout(() => setStatus(current => current?.at === next.at ? null : current), 1800)
    }
  }), [])

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  if (!status) return null
  const label = status.state === 'saving'
    ? 'Opslaan…'
    : status.state === 'saved'
      ? 'Opgeslagen'
      : 'Niet online opgeslagen'

  function retry() {
    const groups = loadGroups(status!.boardName, [])
    saveGroups(status!.boardName, groups)
  }

  return (
    <div className={`board-save-indicator board-save-indicator--${status.state}`} role="status" aria-live="polite">
      <span className="board-save-indicator__dot" aria-hidden />
      <span>
        <strong>{label}</strong>
        {status.state === 'error' && status.message && <small>{status.message}</small>}
      </span>
      {status.state === 'error' && <button type="button" onClick={retry}>Opnieuw</button>}
    </div>
  )
}
