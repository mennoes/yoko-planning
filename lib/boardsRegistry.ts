// Boards registry — dynamische lijst van agenda's. Vervangt de hardcoded
// BOARD_CONFIGS constante uit lib/boards.ts. Leest uit Supabase + cache in
// localStorage, met de vaste gedeelde borden als ingebouwde fallback
// zodat de app blijft werken op een verse install of zonder login.

import type { BoardConfig, ColumnDef } from './boards'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { isOnDemoRoute, notifyDemoBlocked, DEMO_BOARD_IDS } from './demoFixtures'

// Verzonnen bord-config voor /demo — zelfde vorm als de echte 5 borden,
// zodat de 'Agenda's'-sectie in de (hergebruikte) Sidebar er precies zo
// uitziet, maar met nep-klantnamen i.p.v. de echte. columns: [] liet de
// borden eerder als kale naam-lijstjes ogen (geen Status/Owner/Timeline/
// Est Time-kolommen zichtbaar) — dat week zichtbaar af van hoe elk echt
// bord eruitziet, dus nu met dezelfde soort kolomset als de 5 echte
// FALLBACK-borden hieronder.
const DEMO_FALLBACK: BoardConfig[] = [
  { id: DEMO_BOARD_IDS[0], name: DEMO_BOARD_IDS[0], emoji: '🎬', color: '#B0C6EB', columns: [
    { key: 'ownerIds',  label: 'Owner',    type: 'owners',    width: 90  },
    { key: 'status',    label: 'Status',   type: 'status',    width: 145 },
    { key: 'timeline',  label: 'Timeline', type: 'daterange', width: 175 },
    { key: 'deadline',  label: 'Deadline', type: 'date',      width: 105 },
    { key: 'estHours',  label: 'Est Time', type: 'number',    width: 85  },
    { key: 'dagen',     label: 'Dagen',    type: 'number',    width: 70  },
    { key: 'notes',     label: 'Notes',    type: 'text',      width: 160 },
  ] },
  { id: DEMO_BOARD_IDS[1], name: DEMO_BOARD_IDS[1], emoji: '🎨', color: '#D8935B', columns: [
    { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
    { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
    { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
    { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
    { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
    { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
    { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
  ] },
  { id: DEMO_BOARD_IDS[2], name: DEMO_BOARD_IDS[2], emoji: '🎪', color: '#5FA8A0', columns: [
    { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
    { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
    { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
    { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
    { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
    { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
  ] },
]

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
  // Omdenken was oorspronkelijk alleen lokaal aangemaakt. Daardoor kon het
  // na een remote pull uit de registry verdwijnen en bestond de parent-row
  // niet altijd wanneer een item erheen werd verplaatst. Het is nu een vast,
  // gedeeld bord en wordt net als de kern-agenda's automatisch hersteld.
  { id: 'omdenken', name: 'Omdenken', emoji: '📋', color: '#c73561', columns: [
    { key: 'ownerIds',  label: 'Owner',    type: 'owners',    width: 90  },
    { key: 'status',    label: 'Status',   type: 'status',    width: 145 },
    { key: 'timeline',  label: 'Timeline', type: 'daterange', width: 175 },
    { key: 'deadline',  label: 'Deadline', type: 'date',      width: 105 },
    { key: 'estHours',  label: 'Est Time', type: 'number',    width: 85  },
    { key: 'notes',     label: 'Notes',    type: 'text',      width: 160 },
  ] },
  { id: 'dienjaar', name: 'Itorium', emoji: '📋', color: '#00c875', columns: [
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
let localRevision = 0

// Zorgt dat de vaste gedeelde agenda's (incl. Omdenken)
// nooit stil verdwijnen — niet als de localStorage-cache corrupt/incompleet
// is, en niet als een remote pull van de 'boards'-tabel toevallig zonder
// (een van) hen terugkomt. Zonder dit brak een corrupte cache zowel de
// Planning-weergave (BOARD_NAMES mist het bord → geen items) als de eigen
// bord-pagina (BOARD_CONFIGS[id] is undefined → page crasht meteen, vóór
// de Sidebar zelfs maar rendert). Eigen/extra borden van de gebruiker
// blijven gewoon staan; we vullen alleen aan wat ontbreekt.
function withCoreBoards(boards: BoardConfig[]): BoardConfig[] {
  const missing = FALLBACK.filter(f => !boards.some(b => b.id === f.id))
  return missing.length > 0 ? [...boards, ...missing] : boards
}

function readCache(): BoardConfig[] {
  if (isOnDemoRoute()) return DEMO_FALLBACK
  if (cached) return cached
  if (typeof window === 'undefined') return FALLBACK
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as BoardConfig[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        cached = withCoreBoards(parsed)
        return cached
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

// Schrijft een nieuwe kolom-set voor één bord lokaal + pusht naar Supabase
// zodat de wijziging bij alle gebruikers terugkomt. Heeft geen effect op
// andere borden of overige board-config-velden.
export async function setBoardColumns(boardId: string, columns: ColumnDef[]): Promise<void> {
  if (isOnDemoRoute()) { notifyDemoBlocked(); return }
  const current = readCache()
  const idx = current.findIndex(b => b.id === boardId)
  if (idx < 0) return
  const next = current.map((b, i) => i === idx ? { ...b, columns } : b)
  writeCache(next)
  upsertBoard(next[idx], idx).catch(() => {})
}

export function getBoards(): BoardConfig[] { return readCache() }
export function getBoardConfig(id: string): BoardConfig | null {
  return readCache().find(b => b.id === id) ?? null
}
export function getBoardIds(): string[] { return readCache().map(b => b.id) }
export function getBoardColor(id: string): string {
  return readCache().find(b => b.id === id)?.color ?? '#888'
}

export async function renameBoard(boardId: string, name: string): Promise<boolean> {
  const clean = name.trim()
  const current = readCache()
  const existing = current.find(board => board.id === boardId)
  if (!existing || !clean) return false
  localRevision++
  writeCache(current.map(board => board.id === boardId ? { ...board, name: clean } : board))
  const rollback = () => writeCache(readCache().map(board => board.id === boardId ? existing : board))
  if (!supabase) { rollback(); return false }
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) { rollback(); return false }
  try {
    const response = await fetch('/api/boards/rename', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, name: clean }),
    })
    const result = await response.json() as { ok?: boolean; board?: { id: string; name: string } }
    if (!response.ok || !result.ok || result.board?.name !== clean) {
      rollback()
      return false
    }
    return true
  } catch {
    rollback()
    return false
  }
}

export function onBoardsRegistryUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

type Row = { id: string; name: string; emoji: string | null; color: string | null; columns: ColumnDef[] | null; position: number | null }

export async function pullBoardsFromRemote(): Promise<boolean> {
  const revision = localRevision
  if (isOnDemoRoute()) return false
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('boards')
    .select('id, name, emoji, color, columns, position')
    .order('position', { ascending: true })
  if (error || !data || revision !== localRevision) return false

  // Maak ontbrekende vaste agenda's eerst ook echt remote aan. Alleen lokaal
  // aanvullen is onvoldoende: board_groups heeft een FK naar boards en een
  // verplaatsing naar zo'n lokaal-only agenda faalt dan alsnog.
  const rawRemoteRows = data as Row[]
  // Eenmalige naam-migratie na de eerdere save-regressie. Menno had deze
  // agenda al meermaals hernoemd; oude remote data mag niet nóg eens de
  // legacynaam terugzetten. Latere, andere namen blijven onaangeraakt.
  const hasLegacyDienjaar = rawRemoteRows.some(row => row.id === 'dienjaar' && row.name === 'Dienjaar')
  if (hasLegacyDienjaar) {
    await supabase.from('boards').update({ name: 'Itorium', updated_at: new Date().toISOString() }).eq('id', 'dienjaar').eq('name', 'Dienjaar')
  }
  const remoteRows = rawRemoteRows.map(row => row.id === 'dienjaar' && row.name === 'Dienjaar' ? { ...row, name: 'Itorium' } : row)
  const missing = FALLBACK.filter(f => !remoteRows.some(r => r.id === f.id))
  if (missing.length > 0) {
    const { error: seedError } = await supabase.from('boards').upsert(
      missing.map((cfg, index) => ({
        id: cfg.id,
        name: cfg.name,
        emoji: cfg.emoji,
        color: cfg.color,
        columns: cfg.columns,
        position: remoteRows.length + index,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'id' },
    )
    if (seedError) return false
  }

  const seededRows: Row[] = [
    ...remoteRows,
    ...missing.map((cfg, index) => ({
      id: cfg.id, name: cfg.name, emoji: cfg.emoji, color: cfg.color,
      columns: cfg.columns, position: remoteRows.length + index,
    })),
  ]
  const boards: BoardConfig[] = withCoreBoards(seededRows.map(r => ({
    id:      r.id,
    name:    r.name ?? r.id,
    emoji:   r.emoji ?? '📋',
    color:   r.color ?? '#888',
    columns: Array.isArray(r.columns) ? r.columns : [],
  })))
  const next = JSON.stringify(boards)
  if (typeof window !== 'undefined' && localStorage.getItem(LS_KEY) === next) return true
  writeCache(boards)
  return true
}

export async function upsertBoard(cfg: BoardConfig, position: number): Promise<boolean> {
  if (isOnDemoRoute()) { notifyDemoBlocked(); return false }
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
  if (error) return false
  localRevision++
  const current = readCache()
  writeCache(current.some(b => b.id === cfg.id) ? current.map(b => b.id === cfg.id ? cfg : b) : [...current, cfg])
  return true
}

export async function deleteBoard(id: string): Promise<boolean> {
  if (isOnDemoRoute()) { notifyDemoBlocked(); return false }
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('boards').delete().eq('id', id)
  return !error
}

let boardsChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
export function subscribeRemoteBoards(): () => void {
  if (isOnDemoRoute()) return () => {}
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
