import type { BoardGroup, BoardItem, SubItem } from './boards'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { getBoardIds } from './boardsRegistry'

// Filtert dubbele subitems eruit. Door historische sync-bugs én oude
// migraties van Google-id-vormen (it_g_{ev.id} → it_g_{iCalUID}) konden
// twee subitems naast elkaar belanden die feitelijk hetzelfde event waren.
// Dedup-strategie: eerst op id (literal duplicate); daarna op de combinatie
// naam + start + end (zelfde gebeurtenis met andere id-vorm). Volgorde
// blijft behouden: eerste voorkomen wint.
function dedupeSubitems(subs: SubItem[] | undefined): SubItem[] | undefined {
  if (!subs || subs.length < 2) return subs
  const seenIds  = new Set<string>()
  const seenKeys = new Set<string>()
  const out: SubItem[] = []
  for (const s of subs) {
    const id = s?.id
    if (id && seenIds.has(id)) continue
    const name = (s?.name ?? '').trim().toLowerCase()
    const key  = `${name}|${s?.startDate ?? ''}|${s?.endDate ?? ''}`
    // Lege key (geen naam én geen datums) niet dedupen — die kan voorkomen
    // bij net-aangemaakte handmatige subitems en willen we ongemoeid laten.
    if (name && seenKeys.has(key)) continue
    if (id) seenIds.add(id)
    if (name) seenKeys.add(key)
    out.push(s)
  }
  return out
}

// ─── Per-board localStorage keys ─────────────────────────────────────────────
function key(boardName: string)      { return `yoko-board-${boardName}` }
// "Dirty" markeert dat lokale state nog niet bevestigd-gepushed is naar
// Supabase. Een pull mag deze NIET overschrijven, anders verlies je je
// eigen wijzigingen na refresh als de push wegviel.
function dirtyKey(boardName: string) { return `yoko-board-${boardName}-dirty` }

// BOARD_NAMES is dynamisch — leeg op SSR, gevuld op client zodra de
// registry is geladen. Bestaande code die `for (const b of BOARD_NAMES)`
// doet werkt nog (Proxy levert array-iteratie).
export const BOARD_NAMES: string[] = new Proxy([] as string[], {
  get(_t, prop) {
    const ids = getBoardIds()
    if (prop === 'length') return ids.length
    if (prop === Symbol.iterator) return ids[Symbol.iterator].bind(ids)
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return ids[Number(prop)]
    if (prop === 'map' || prop === 'filter' || prop === 'forEach' || prop === 'includes' || prop === 'indexOf' || prop === 'find' || prop === 'some' || prop === 'every' || prop === 'slice' || prop === 'concat' || prop === 'reduce') {
      const fn = ids[prop as keyof typeof ids] as unknown as (...args: unknown[]) => unknown
      return fn.bind(ids)
    }
    return (ids as unknown as Record<string | symbol, unknown>)[prop as string]
  },
})
export type BoardName = string

// ─── Load / save ──────────────────────────────────────────────────────────────
export function loadGroups(boardName: string, fallback: BoardGroup[]): BoardGroup[] {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key(boardName))
    return raw ? (JSON.parse(raw) as BoardGroup[]) : fallback
  } catch { return fallback }
}

export function saveGroups(boardName: string, groups: BoardGroup[]): void {
  const next = JSON.stringify(groups)
  const prev = localStorage.getItem(key(boardName))
  if (prev === next) return            // no-op: breaks the realtime ping-pong loop
  localStorage.setItem(key(boardName), next)
  localStorage.setItem(dirtyKey(boardName), Date.now().toString())
  window.dispatchEvent(new CustomEvent('yoko-board-update', { detail: { boardName } }))
  pushBoardToRemote(boardName, groups).then(ok => {
    if (!ok) return
    // Alleen flag wissen als wat we nét gepusht hebben nog steeds = wat
    // er in localStorage staat. Tussentijdse wijzigingen → flag blijft
    // staan, volgende push schoont 'm op.
    if (localStorage.getItem(key(boardName)) === next) {
      localStorage.removeItem(dirtyKey(boardName))
    }
  }).catch(() => {})
}

// ─── Remote sync ─────────────────────────────────────────────────────────────
function rowToItem(r: Record<string, unknown>): BoardItem {
  return {
    id:        String(r.id),
    name:      (r.name as string) ?? '',
    ownerIds:  (r.owner_ids as string[]) ?? [],
    status:    (r.status as string) ?? '',
    startDate: (r.start_date as string | null) ?? null,
    endDate:   (r.end_date as string | null) ?? null,
    deadline:  (r.deadline as string | null) ?? null,
    estHours:  Number(r.est_hours ?? 0),
    dagen:     Number(r.dagen ?? 0),
    notes:     (r.notes as string | undefined) ?? undefined,
    contactpersoon: (r.contactpersoon as string | undefined) ?? undefined,
    uitzenddag:     (r.uitzenddag as string | null) ?? null,
    framelink:      (r.framelink as string | undefined) ?? undefined,
    nummers:        (r.nummers as number | undefined) ?? undefined,
    subitems:       dedupeSubitems(r.subitems as BoardItem['subitems']) ?? undefined,
    journal:        (r.journal as BoardItem['journal']) ?? undefined,
    source:         (r.source as BoardItem['source']) ?? undefined,
    externalLink:   (r.external_link as string | undefined) ?? undefined,
    ...((r.extra as Record<string, unknown>) ?? {}),    // includes ownerHours
  } as BoardItem
}

export async function pullBoardFromRemote(boardName: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  // Niet-bevestigde lokale wijzigingen mogen NOOIT worden overschreven door
  // een pull. Push 'em eerst omhoog; faalt dat, dan slaan we de pull over.
  if (typeof window !== 'undefined' && localStorage.getItem(dirtyKey(boardName))) {
    const localRaw = localStorage.getItem(key(boardName))
    if (localRaw) {
      try {
        const localGroups = JSON.parse(localRaw) as BoardGroup[]
        const ok = await pushBoardToRemote(boardName, localGroups)
        if (!ok) return false  // push failed, niet pullen want we zouden lokale changes verliezen
        if (localStorage.getItem(key(boardName)) === localRaw) {
          localStorage.removeItem(dirtyKey(boardName))
        }
      } catch { return false }
    }
  }
  const { data: groupRows, error: gErr } = await supabase
    .from('board_groups').select('*').eq('board_id', boardName).order('position')
  if (gErr || !groupRows) return false
  const { data: itemRows, error: iErr } = await supabase
    .from('board_items').select('*').eq('board_id', boardName).order('position')
  if (iErr || !itemRows) return false

  const itemsByGroup = new Map<string, BoardItem[]>()
  for (const r of itemRows) {
    const it = rowToItem(r as Record<string, unknown>)
    const gid = String((r as { group_id: string }).group_id)
    const arr = itemsByGroup.get(gid) ?? []
    arr.push(it); itemsByGroup.set(gid, arr)
  }

  const groups: BoardGroup[] = (groupRows as Record<string, unknown>[]).map(r => ({
    id:        String(r.id),
    name:      (r.name as string) ?? '',
    color:     (r.color as string) ?? '#9aadbd',
    collapsed: (r.collapsed as boolean) ?? false,
    items:     itemsByGroup.get(String(r.id)) ?? [],
  }))

  if (groups.length === 0) return false  // remote is empty — keep local fallback
  const serialized = JSON.stringify(groups)
  if (localStorage.getItem(key(boardName)) === serialized) return true  // no change
  localStorage.setItem(key(boardName), serialized)
  window.dispatchEvent(new CustomEvent('yoko-board-update', { detail: { boardName } }))
  return true
}

const STANDARD_FIELDS = new Set([
  'id','name','ownerIds','status','startDate','endDate','deadline','estHours',
  'dagen','notes','contactpersoon','uitzenddag','framelink','nummers','subitems','journal',
  'source','externalLink',
  // 'ownerHours' is intentionally NOT here — it lives in the `extra` JSON
  // column since the board_items table has no dedicated column for it.
])
function itemToRow(boardName: string, groupId: string, position: number, item: BoardItem): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const k of Object.keys(item)) {
    if (!STANDARD_FIELDS.has(k)) extra[k] = (item as Record<string, unknown>)[k]
  }
  return {
    id:         item.id,
    group_id:   groupId,
    board_id:   boardName,
    name:       item.name,
    owner_ids:  item.ownerIds ?? [],
    status:     item.status ?? null,
    start_date: item.startDate ?? null,
    end_date:   item.endDate ?? null,
    deadline:   item.deadline ?? null,
    est_hours:  item.estHours ?? 0,
    dagen:      item.dagen ?? 0,
    notes:      item.notes ?? null,
    contactpersoon: item.contactpersoon ?? null,
    uitzenddag:     item.uitzenddag ?? null,
    framelink:      item.framelink ?? null,
    nummers:        item.nummers ?? null,
    subitems:       dedupeSubitems(item.subitems) ?? [],
    journal:        item.journal ?? [],
    extra,
    position,
    updated_at: new Date().toISOString(),
  }
}

export async function pushBoardToRemote(boardName: string, groups: BoardGroup[]): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false

  // Upsert groups
  const groupRows = groups.map((g, gi) => ({
    id: g.id, board_id: boardName, name: g.name,
    color: g.color ?? '#9aadbd', collapsed: g.collapsed ?? false, position: gi,
  }))
  const { error: gErr } = await supabase.from('board_groups').upsert(groupRows, { onConflict: 'id' })
  if (gErr) return false

  // Upsert items
  const itemRows: Record<string, unknown>[] = []
  const localItemIds = new Set<string>()
  for (const g of groups) {
    g.items.forEach((it, idx) => {
      itemRows.push(itemToRow(boardName, g.id, idx, it))
      localItemIds.add(it.id)
    })
  }
  if (itemRows.length > 0) {
    const { error: iErr } = await supabase.from('board_items').upsert(itemRows, { onConflict: 'id' })
    if (iErr) return false
  }

  // Reconcile deletions: fetch remote IDs, delete those missing locally
  const localGroupIds = new Set(groups.map(g => g.id))
  const { data: remoteItems } = await supabase
    .from('board_items').select('id').eq('board_id', boardName)
  if (remoteItems) {
    const stale = (remoteItems as { id: string }[]).map(r => r.id).filter(id => !localItemIds.has(id))
    if (stale.length > 0) await supabase.from('board_items').delete().in('id', stale)
  }
  const { data: remoteGroups } = await supabase
    .from('board_groups').select('id').eq('board_id', boardName)
  if (remoteGroups) {
    const stale = (remoteGroups as { id: string }[]).map(r => r.id).filter(id => !localGroupIds.has(id))
    if (stale.length > 0) await supabase.from('board_groups').delete().in('id', stale)
  }

  return true
}

const channelByBoard: Record<string, ReturnType<NonNullable<typeof supabase>['channel']>> = {}

// Debounce realtime-triggered pulls so a batch of N events (e.g. Google sync
// upserting 50 items at once) doesn't fan out into N parallel REST fetches.
const pullTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function schedulePull(boardName: string) {
  if (pullTimers[boardName]) return
  pullTimers[boardName] = setTimeout(() => {
    delete pullTimers[boardName]
    pullBoardFromRemote(boardName).catch(() => {})
  }, 600)
}

export function subscribeRemoteBoard(boardName: string): () => void {
  if (!supabase) return () => {}
  if (channelByBoard[boardName]) return () => {}
  const ch = supabase.channel(`board:${boardName}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_items',  filter: `board_id=eq.${boardName}` }, () => schedulePull(boardName))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_groups', filter: `board_id=eq.${boardName}` }, () => schedulePull(boardName))
    .subscribe()
  channelByBoard[boardName] = ch
  return () => { supabase!.removeChannel(ch); delete channelByBoard[boardName] }
}

// ─── Move one item to another board ───────────────────────────────────────────
// Removes the item from the source board's group and adds it to the target
// board. Google items land in the target's "Google Agenda" group (auto-
// created when missing); other items land in the target's first group, or
// in a new "Verplaatst" group if the target board is empty. Both boards get
// saved (which propagates to Supabase + dispatches yoko-board-update).
export function moveItemToBoard(
  itemId:        string,
  sourceBoard:   string,
  targetBoard:   string,
  fallbackGroups: Record<string, BoardGroup[]>,
): { ok: boolean; message?: string } {
  if (sourceBoard === targetBoard) return { ok: false, message: 'Zelfde bord' }
  if (typeof window === 'undefined') return { ok: false, message: 'No window' }

  const srcGroups = loadGroups(sourceBoard, fallbackGroups[sourceBoard] ?? [])
  const movedItem = srcGroups.flatMap(g => g.items).find(i => i.id === itemId) ?? null
  if (!movedItem) return { ok: false, message: 'Item niet gevonden op bron-bord' }
  const updatedSource = srcGroups.map(g => ({
    ...g,
    items: g.items.filter(i => i.id !== itemId),
  }))

  const tgtGroups = loadGroups(targetBoard, fallbackGroups[targetBoard] ?? [])
  // Land het item in de bovenste groep van het doel-bord, ongeacht source.
  // Alleen als het bord leeg is maken we alsnog een groep aan.
  let updatedTarget: BoardGroup[]
  if (tgtGroups.length > 0) {
    updatedTarget = tgtGroups.map((g, idx) =>
      idx === 0 ? { ...g, items: [...g.items, movedItem] } : g
    )
  } else {
    const newGroup: BoardGroup = {
      id:        `g_${targetBoard}_${Date.now()}`,
      name:      'Lopende projecten',
      color:     '#9aadbd',
      collapsed: false,
      items:     [movedItem],
    }
    updatedTarget = [newGroup]
  }

  saveGroups(sourceBoard, updatedSource)
  saveGroups(targetBoard, updatedTarget)
  return { ok: true }
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
