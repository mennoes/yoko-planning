import type { BoardGroup, BoardItem, SubItem } from './boards'
import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { getBoardIds } from './boardsRegistry'
import { normalizeTitle } from './subitemRules'

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
  // Soft-deleted rijen filteren we out — die staan in de papierbak.
  // 'is.null'-syntax werkt via .is('deleted_at', null) in supabase-js.
  const { data: groupRows, error: gErr } = await supabase
    .from('board_groups').select('*').eq('board_id', boardName).is('deleted_at', null).order('position')
  if (gErr || !groupRows) return false
  const { data: itemRows, error: iErr } = await supabase
    .from('board_items').select('*').eq('board_id', boardName).is('deleted_at', null).order('position')
  if (iErr || !itemRows) return false

  // PER-USER FILTER voor Google-meetings: in de DB hebben teamleden
  // hun eigen rij per event (stabiel, geen sync-race). Hier laten we
  // alleen MIJN eigen rijen door — Vincent's Google-rijen verschijnen
  // niet in mijn weergave en omgekeerd. Geen merging, geen velden door
  // elkaar halen, geen verlies van source/externalLink/Meet-link.
  // Manual items en Google-rijen zonder external_user_id blijven
  // gewoon zichtbaar voor iedereen.
  const myUid = await getCurrentUserId()
  type AnyRow = Record<string, unknown>
  const visibleRows: AnyRow[] = []
  for (const r of itemRows as AnyRow[]) {
    const src = String(r.source ?? '')
    if (src !== 'google') {
      visibleRows.push(r)
      continue
    }
    const rowUid = (r.external_user_id as string | null) ?? null
    if (!rowUid) {
      // Legacy Google-rij zonder external_user_id (van vóór per-user
      // sync). Toon 'm gewoon — beter dan onzichtbaar.
      visibleRows.push(r)
      continue
    }
    if (!myUid || rowUid === myUid) {
      // 't is van mij. Toon.
      visibleRows.push(r)
    }
    // anders: rij van iemand anders, niet tonen.
  }

  const itemsByGroup = new Map<string, BoardItem[]>()
  for (const r of visibleRows) {
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
  // Stempel de tijd waarop we de remote-staat hebben gezien. pushBoard-
  // ToRemote gebruikt die als cutoff voor stale-deletes — rijen NA deze
  // tijd toegevoegd door anderen worden niet stilzwijgend verwijderd.
  writeLastSync(boardName)
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

function lastSyncKey(board: string): string { return `yoko-board-last-sync:${board}` }
function readLastSync(board: string): number {
  if (typeof window === 'undefined') return 0
  const v = parseInt(window.localStorage.getItem(lastSyncKey(board)) ?? '', 10)
  return Number.isFinite(v) ? v : 0
}
function writeLastSync(board: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(lastSyncKey(board), String(Date.now())) } catch {}
}

export async function pushBoardToRemote(boardName: string, groups: BoardGroup[]): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false

  // SAFETY GUARD #1 — als de lokale state verdacht leeg is (geen groepen
  // EN geen items) maar de remote NIET, weigeren we de push. Dat is bijna
  // altijd een stale localStorage van een verse login die anders alle
  // bestaande data zou wegvegen via de reconcile-deletie hieronder.
  const totalLocalItems = groups.reduce((s, g) => s + g.items.length, 0)
  if (groups.length === 0 && totalLocalItems === 0) {
    const { count: remoteCount } = await supabase
      .from('board_groups').select('id', { count: 'exact', head: true })
      .eq('board_id', boardName)
    if ((remoteCount ?? 0) > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[boardStore] Push abort: lokale state leeg voor '${boardName}' maar remote heeft ${remoteCount} groepen. Stale cache?`)
      return false
    }
  }

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

  // SAFETY GUARD #2 — reconcile-deletie alleen voor rijen die OUDER zijn
  // dan onze laatste succesvolle pull. Een rij die NA dat moment door
  // iemand anders is toegevoegd, hebben wij nog niet gezien — die mogen
  // we niet stilzwijgend wegvegen omdat wij 'm toevallig niet in onze
  // lokale kopie hebben. Dit voorkomt het 'andere user logt in en alle
  // projecten zijn weg'-scenario.
  const lastSync = readLastSync(boardName)
  const SYNC_MARGIN_MS = 5_000   // veiligheidsmarge — clock-skew tolerantie
  const cutoff = new Date(Math.max(0, lastSync - SYNC_MARGIN_MS)).toISOString()
  const localGroupIds = new Set(groups.map(g => g.id))

  // Items — SOFT-DELETE: in plaats van hard DELETE zetten we deleted_at
  // zodat de papierbak ze kan tonen en herstellen. Niets gaat écht weg.
  const stamp = new Date().toISOString()
  const { data: remoteItems } = await supabase
    .from('board_items').select('id, updated_at').eq('board_id', boardName).is('deleted_at', null)
  if (remoteItems) {
    const stale = (remoteItems as { id: string; updated_at: string | null }[])
      .filter(r => !localItemIds.has(r.id))
      .filter(r => !lastSync || (r.updated_at && r.updated_at < cutoff))
      .map(r => r.id)
    if (stale.length > 0) {
      await supabase.from('board_items')
        .update({ deleted_at: stamp })
        .in('id', stale)
    }
  }
  // Groups — eerste push uit een verse sessie verwijdert NOOIT remote
  // groepen. Ook hier soft-delete via deleted_at-stamp.
  if (lastSync > 0) {
    const { data: remoteGroups } = await supabase
      .from('board_groups').select('id').eq('board_id', boardName).is('deleted_at', null)
    if (remoteGroups) {
      const stale = (remoteGroups as { id: string }[]).map(r => r.id).filter(id => !localGroupIds.has(id))
      if (stale.length > 0) {
        await supabase.from('board_groups')
          .update({ deleted_at: stamp })
          .in('id', stale)
      }
    }
  }

  return true
}

// ─── Papierbak helpers ────────────────────────────────────────────────────────
export type TrashItem = {
  id:         string
  name:       string
  boardId:    string
  groupId:    string | null
  deletedAt:  string
  groupName:  string | null
}

export async function loadTrash(): Promise<TrashItem[]> {
  if (!supabase) return []
  if (!await getCurrentUserId()) return []
  const { data } = await supabase
    .from('board_items')
    .select('id, name, board_id, group_id, deleted_at, board_groups(name)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(500)
  if (!data) return []
  type Row = { id: string; name: string; board_id: string; group_id: string; deleted_at: string; board_groups: { name: string } | { name: string }[] | null }
  return (data as Row[]).map(r => ({
    id:        r.id,
    name:      r.name ?? '(naamloos)',
    boardId:   r.board_id,
    groupId:   r.group_id,
    deletedAt: r.deleted_at,
    groupName: Array.isArray(r.board_groups) ? (r.board_groups[0]?.name ?? null) : (r.board_groups?.name ?? null),
  }))
}

// Restore = deleted_at op null zetten. Bij groep ook eventueel de groep
// zelf herstellen (anders is 't item een wees). De groep wordt automatisch
// hersteld als-ie nog in soft-deleted state staat.
export async function restoreTrashItem(itemId: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { data: itemData } = await supabase
    .from('board_items').select('group_id').eq('id', itemId).single()
  const groupId = (itemData as { group_id: string } | null)?.group_id
  if (groupId) {
    await supabase.from('board_groups')
      .update({ deleted_at: null })
      .eq('id', groupId)
      .not('deleted_at', 'is', null)
  }
  const { error } = await supabase.from('board_items')
    .update({ deleted_at: null })
    .eq('id', itemId)
  return !error
}

export async function purgeTrashItem(itemId: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('board_items').delete().eq('id', itemId)
  return !error
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
// Leer een routing-regel wanneer een gebruiker een Google-event handmatig
// naar een ander bord verplaatst. We normaliseren de titel (zonder episode-
// nummers, datums, "aflv 3", "(2×)" suffixen) zodat alle afleveringen onder
// dezelfde naam dezelfde regel triggeren. Inserten alleen wanneer er nog
// geen identieke regel staat — de upsert lost duplicaten anders silent op.
async function learnBoardRoutingRule(itemName: string, targetBoard: string): Promise<void> {
  if (!supabase) return
  const pattern = normalizeTitle(itemName)
  // Min lengte ophogen van 3 → 8 zodat we niet leren op te-korte/te-generieke
  // patronen ('call', 'lunch', 'sync') die via substring-match later
  // onvoorspelbare events zouden meeslepen. Voorbeelden die wél door komen:
  // 'wekelijkse check-in' (19), 'team standup' (12), 'femsplainers' (12).
  if (!pattern || pattern.length < 8) return
  // Check op een bestaande regel met dit pattern. Als die al richting het
  // doel-bord wijst zijn we klaar; wijst-ie naar een ander bord, update 'm
  // naar de nieuwste keuze (gebruiker stuurt hier expliciet bij).
  const { data: existing } = await supabase
    .from('calendar_routing_rules')
    .select('id, board_id')
    .eq('pattern', pattern)
    .limit(1)
  const row = (existing as { id: string; board_id: string }[] | null)?.[0]
  if (row) {
    if (row.board_id === targetBoard) return
    await supabase.from('calendar_routing_rules')
      .update({ board_id: targetBoard, enabled: true })
      .eq('id', row.id)
    logRoutingRuleChange(pattern, targetBoard, 'updated').catch(() => {})
    return
  }
  await supabase.from('calendar_routing_rules').insert({
    pattern,
    board_id: targetBoard,
    enabled:  true,
    position: 100,  // user-leerde regels achteraan; expliciete seed-regels behouden voorrang
  })
  logRoutingRuleChange(pattern, targetBoard, 'created').catch(() => {})
}

// Audit-log entry zodat in de Activiteit-feed te zien is wanneer en waarom
// er een routing-regel is bijgekomen. Daarvoor was 't onzichtbaar dat een
// item-verplaatsing automatisch ook toekomstige events zou meeslepen —
// gebruikers kwamen voor verrassingen te staan ('waarom verschijnen er
// opeens nieuwe items in dit bord?').
async function logRoutingRuleChange(pattern: string, targetBoard: string, action: 'created' | 'updated'): Promise<void> {
  if (!supabase) return
  const uid = await getCurrentUserId()
  if (!uid) return
  const verb   = action === 'created' ? 'Routing-regel aangemaakt' : 'Routing-regel bijgewerkt'
  const detail = `Toekomstige events met '${pattern}' → bord '${targetBoard}'`
  await supabase.from('activity').insert({
    user_id: uid,
    action:  verb,
    target:  `routing_rule:${pattern}`,
    detail,
  })
}

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

  // Leer een routing-regel wanneer een Google-event handmatig naar een ander
  // bord wordt gezet. Volgende syncs vinden events met dezelfde (genormali-
  // seerde) titel automatisch hier terug — geen handmatig verslepen meer.
  if (movedItem.source === 'google') {
    learnBoardRoutingRule(movedItem.name, targetBoard).catch(() => {})
  }
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
