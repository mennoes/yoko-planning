export const BOARD_SAVE_STATUS_EVENT = 'yoko-board-save-status'

export type BoardSaveState = 'saving' | 'saved' | 'error'

export type BoardSaveStatus = {
  boardName: string
  state: BoardSaveState
  message?: string
  at: number
}

export function emitBoardSaveStatus(status: Omit<BoardSaveStatus, 'at'>): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<BoardSaveStatus>(BOARD_SAVE_STATUS_EVENT, {
    detail: { ...status, at: Date.now() },
  }))
}

export function subscribeBoardSaveStatus(listener: (status: BoardSaveStatus) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => listener((event as CustomEvent<BoardSaveStatus>).detail)
  window.addEventListener(BOARD_SAVE_STATUS_EVENT, handler)
  return () => window.removeEventListener(BOARD_SAVE_STATUS_EVENT, handler)
}
