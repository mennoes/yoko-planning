import type { BoardGroup, BoardItem } from './boards'

// ─── Per-board localStorage keys ─────────────────────────────────────────────
function key(boardName: string) { return `yoko-board-${boardName}` }

export const BOARD_NAMES = ['yoko', 'pnp', 'nederland', 'vlaanderen', 'dienjaar'] as const
export type  BoardName   = typeof BOARD_NAMES[number]

// ─── Load / save ──────────────────────────────────────────────────────────────
export function loadGroups(boardName: string, fallback: BoardGroup[]): BoardGroup[] {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key(boardName))
    return raw ? (JSON.parse(raw) as BoardGroup[]) : fallback
  } catch { return fallback }
}

export function saveGroups(boardName: string, groups: BoardGroup[]): void {
  localStorage.setItem(key(boardName), JSON.stringify(groups))
}

// ─── Patch one item's dates across one board ──────────────────────────────────
export function patchItemDates(
  boardName: string,
  itemId:    string,
  startDate: string | null,
  endDate:   string | null,
  fallbackGroups: BoardGroup[],
): BoardGroup[] {
  const groups = loadGroups(boardName, fallbackGroups)
  const updated = groups.map(g => ({
    ...g,
    items: g.items.map(i =>
      i.id === itemId ? { ...i, startDate, endDate } : i
    ),
  }))
  saveGroups(boardName, updated)
  return updated
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}
