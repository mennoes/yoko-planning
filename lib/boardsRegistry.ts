// Boards registry — dynamische lijst van agenda's. Vervangt de hardcoded
// BOARD_CONFIGS constante uit lib/boards.ts. Leest uit Supabase + cache in
// localStorage, met de oorspronkelijke 5 borden als ingebouwde fallback
// zodat de app blijft werken op een verse install of zonder login.

import type { BoardConfig, ColumnDef } from './boards'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

const LS_KEY = 'yoko-boards-registry'
const UPDATE_EVENT = 'yoko-boards-registry-update'

// Ingebouwde fallback voor offline / verse install / not-logged-in.
const FALLBACK: BoardConfig[] = [
  { id: 'yoko', name: 'yoko', emoji: '📋', color: '#579bfc', columns: [
    { key: 'ownerIds',  label: 'Owner',    type: 'owners',    width: 90  },
    { key: 'status',    label: 'Status',   type: 'status',    width: 145 },
    { key: 'timeline',  label: 'Timeline', type: 'daterange', width: 175 },
    { key: 'deadline',  label: 'Deadline', type: 'date',      width: 105 },
    { key: 'estHours',  label: 'Est Time', type: 'number',    width: 85  },
    { key: 'dagen',     label: 'Dagen',    type: 'number',    width: 70  },
    { key: 'notes',     label: 'Notes',    type: 'text',      width: 160 },
  ] },
  { id: 'pnp', name: 'PnP', emoji: '📋', color: '#e2445c', columns: [
    { key: 'ownerIds',       label: 'Persoon',        type: 'owners',    width: 90  },
    { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
    { key: 'timeline',       label: 'Tijdlijn',       type: 'daterange', width: 175 },
    { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
    { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
    { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
    { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
  ] },
  { id: 'nederland', name: 'Nederland', emoji: '📋', color: '#9c7ee8', columns: [
    { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
    { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
    { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
    { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 175 },
    { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
    { key: 'uitzenddag',     label: 'Uitzenddag',     type: 'date',      width: 105 },
    { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
  ] },
  { id: 'vlaanderen', name: 'Vlaanderen', emoji: '📋', color: '#ff7a00', columns: [
    { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
    { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
    { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
    { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
    { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
    { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
    { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
    { key: 'framelink',      label: 'Frame link',     type: 'url',       width: 110 },
  ] },
  { id: 'dienjaar', name: 'Dienjaar', emoji: '📋', color: '#00c875', columns: [
    { key: 'ownerIds', label: 'Owner',    type: 'owners',    width: 90  },
    { key: 'timeline', label: 'Tijdlijn', type: 'daterange', width: 175 },
    { key: 'status',   label: 'Status',   type: 'status',    width: 145 },
    { key: 'estHours', label: 'Uren',     type: 'number',    width: 80  },
    { key: 'dagen',    label: 'Dagen',    type: 'number',    width: 70  },
    { key: 'deadline', label: 'Deadline', type: 'date',      width: 105 },
    { key: 'nummers',  label: 'Nummers',  type: 'currency',  width: 110 },
  ] },
]

let cached: BoardConfig[] | null = null

function readCache(): BoardConfig[] {
  if (cached) return cached
  if (typeof window === 'undefined') return FALLBACK
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as BoardConfig[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        cached = parsed
        return parsed
      }
    }
  } catch {}
  cached = FALLBACK
  return FALLBACK
}

function writeCache(boards: BoardConfig[]): void {
  cached = boards
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LS_KEY, JSON.stringify(boards)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function getBoards(): BoardConfig[] { return readCache() }
export function getBoardConfig(id: string): BoardConfig | null {
  return readCache().find(b => b.id === id) ?? null
}
export function getBoardIds(): string[] { return readCache().map(b => b.id) }
export function getBoardColor(id: string): string {
  return readCache().find(b => b.id === id)?.color ?? '#888'
}

export function onBoardsRegistryUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

type Row = { id: string; name: string; emoji: string | null; color: string | null; columns: ColumnDef[] | null; position: number | null }

export async function pullBoardsFromRemote(): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('boards')
    .select('id, name, emoji, color, columns, position')
    .order('position', { ascending: true })
  if (error || !data) return false
  if (data.length === 0) return false
  const boards: BoardConfig[] = (data as Row[]).map(r => ({
    id:      r.id,
    name:    r.name ?? r.id,
    emoji:   r.emoji ?? '📋',
    color:   r.color ?? '#888',
    columns: Array.isArray(r.columns) ? r.columns : [],
  }))
  const next = JSON.stringify(boards)
  if (typeof window !== 'undefined' && localStorage.getItem(LS_KEY) === next) return true
  writeCache(boards)
  return true
}

export async function upsertBoard(cfg: BoardConfig, position: number): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('boards').upsert({
    id:        cfg.id,
    name:      cfg.name,
    emoji:     cfg.emoji,
    color:     cfg.color,
    columns:   cfg.columns,
    position,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  return !error
}

export async function deleteBoard(id: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('boards').delete().eq('id', id)
  return !error
}

let boardsChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
export function subscribeRemoteBoards(): () => void {
  if (!supabase) return () => {}
  if (boardsChannel) return () => {}
  const ch = supabase.channel('boards')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, () => {
      pullBoardsFromRemote().catch(() => {})
    })
    .subscribe()
  boardsChannel = ch
  return () => {
    if (supabase && boardsChannel) {
      supabase.removeChannel(boardsChannel)
      boardsChannel = null
    }
  }
}

/** Standaard kolom-set voor een nieuw bord (gekopieerd van yoko). */
export function defaultColumnsForNewBoard(): ColumnDef[] {
  return [
    { key: 'ownerIds', label: 'Owner',    type: 'owners',    width: 90  },
    { key: 'status',   label: 'Status',   type: 'status',    width: 145 },
    { key: 'timeline', label: 'Timeline', type: 'daterange', width: 175 },
    { key: 'deadline', label: 'Deadline', type: 'date',      width: 105 },
    { key: 'estHours', label: 'Est Time', type: 'number',    width: 85  },
    { key: 'notes',    label: 'Notes',    type: 'text',      width: 160 },
  ]
}
