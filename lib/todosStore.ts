'use client'

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type ProjectLink = { board: string; itemId: string; name: string; startDate?: string | null; endDate?: string | null }
export type TodoItem    = { id: string; text: string; done: boolean; projectRef?: ProjectLink }
export type Section     = { id: string; title: string; emoji: string; items: TodoItem[]; kind?: 'personal' | 'general' }

const STORAGE_KEY = 'yoko-todos'
const EVENT       = 'yoko-todos-update'
// Zelfde key als app/todos/page.tsx (deleteSection) gebruikt — daar puur
// om de auto-seed te laten weten dat een sectie bewust weg is; hier om
// pushToRemote te vertellen wélke sectie-id's expliciet verwijderd zijn.
const DELETED_SECTION_IDS_KEY = 'yoko-todos-deleted-sections'
const DELETED_ITEM_IDS_KEY    = 'yoko-todos-deleted-item-ids'

export function loadSections(fallback: Section[]): Section[] {
  if (typeof window === 'undefined') return fallback
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? JSON.parse(s) : fallback
  } catch { return fallback }
}

function writeCache(sections: Section[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sections)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function saveSections(sections: Section[]): void {
  // Zet de lokale-write-lock zodat realtime pulls die hierna binnenkomen
  // (door onze eigen pushToRemote) niet de ongedeleted/ongepushte
  // staat terugplakken bovenop wat we net lokaal wijzigden.
  markLocalWrite()
  writeCache(sections)
  pushWithRetry(sections)
}

/** Verwijderd item — onthouden zodat pushToRemote 'm expliciet mag
 *  wissen op Supabase, i.p.v. impliciet af te leiden uit "staat niet
 *  (meer) in mijn huidige lokale array" (zie pushToRemote-comment). */
export function markItemDeleted(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const set = loadIdSet(DELETED_ITEM_IDS_KEY)
    set.add(id)
    localStorage.setItem(DELETED_ITEM_IDS_KEY, JSON.stringify([...set]))
  } catch {}
}

/** pushToRemote faalt soms door een kortstondig netwerkhaperinkje (net
 *  een nieuwe tab, device net wakker, etc). Fire-and-forget zonder
 *  retry laat de remote-staat dan permanent achter — en de volgende
 *  pull (bv. in een nieuwe tab) plakt die stale staat terug over wat
 *  je net lokaal wijzigde. 3 pogingen met korte backoff dekt de
 *  meeste transiënte gevallen; blijft 't falen dan loggen we 't
 *  zichtbaar i.p.v. silent te swallowen. */
async function pushWithRetry(sections: Section[], attempt = 0): Promise<void> {
  const ok = await pushToRemote(sections).catch(err => {
    console.error('[todosStore] pushToRemote error (attempt', attempt + 1, ')', err)
    return false
  })
  if (ok) return
  if (attempt >= 2) {
    console.error('[todosStore] pushToRemote bleef falen na 3 pogingen — todos zijn niet gesynchroniseerd naar Supabase.')
    return
  }
  await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
  return pushWithRetry(sections, attempt + 1)
}

export function onTodosUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** Merge een net-gepulde remote-snapshot met de lokale staat i.p.v. 'm
 *  klakkeloos te overschrijven. Een pull kan best een item/sectie MISSEN
 *  die lokaal al bestaat — bv. omdat een eerdere push nog niet was
 *  aangekomen, of nog niet is doorgedrongen tot deze read-replica. Een
 *  blinde overwrite (setSections(remote)) liet zo'n net-afgevinkt item
 *  weer als 'open' verschijnen, en erger: de reactieve auto-seed-effecten
 *  in app/todos/page.tsx zagen dat project-item dan als 'nog niet
 *  geseed' en voegden 'm opnieuw toe — een zichtbaar duplicaat, met de
 *  done-state weer op false.
 *
 *  Regels:
 *  - Expliciet verwijderde secties/items (zie DELETED_*_KEY) blijven weg,
 *    van welke kant ze ook komen.
 *  - Bestaat een item in beide? 'done' wint zodra ÉÉN kant 'm afgerond
 *    ziet — een net-bevestigde toggle kan nooit door een trage pull
 *    worden terug gezet naar open.
 *  - Bestaat een sectie/item alleen lokaal (nog niet gepusht) of alleen
 *    remote (door een ander tabblad/toestel toegevoegd)? Beide blijven
 *    staan — vereniging, geen doorsnede. */
export function mergeSections(local: Section[], remote: Section[]): Section[] {
  const deletedSectionIds = loadIdSet(DELETED_SECTION_IDS_KEY)
  const deletedItemIds    = loadIdSet(DELETED_ITEM_IDS_KEY)
  const remoteById = new Map(remote.map(s => [s.id, s]))
  const seen = new Set<string>()
  const merged: Section[] = []

  for (const ls of local) {
    if (deletedSectionIds.has(ls.id)) continue
    seen.add(ls.id)
    const rs = remoteById.get(ls.id)
    merged.push(rs ? { ...ls, items: mergeItems(ls.items, rs.items, deletedItemIds) } : ls)
  }
  for (const rs of remote) {
    if (seen.has(rs.id) || deletedSectionIds.has(rs.id)) continue
    merged.push({ ...rs, items: rs.items.filter(i => !deletedItemIds.has(i.id)) })
  }
  return merged
}

function mergeItems(localItems: TodoItem[], remoteItems: TodoItem[], deletedItemIds: Set<string>): TodoItem[] {
  const remoteById = new Map(remoteItems.map(i => [i.id, i]))
  const seen = new Set<string>()
  const out: TodoItem[] = []
  for (const li of localItems) {
    if (deletedItemIds.has(li.id)) continue
    seen.add(li.id)
    const ri = remoteById.get(li.id)
    out.push(ri ? { ...li, done: li.done || ri.done } : li)
  }
  for (const ri of remoteItems) {
    if (seen.has(ri.id) || deletedItemIds.has(ri.id)) continue
    out.push(ri)
  }
  return out
}

// ─── Remote sync ──────────────────────────────────────────────────────────────
type SectionRow = { id: string; title: string; emoji: string; position: number }
type ItemRow    = { id: string; section_id: string; text: string; done: boolean; position: number; project_ref: ProjectLink | null }

/** Pull from Supabase. Returns null if no auth, empty remote, or a local
 *  write is still within its lock window (zie withinLocalWriteLock). */
export async function pullFromRemote(): Promise<Section[] | null> {
  if (!supabase) return null
  // Net lokaal een vinkje gezet en meteen de pagina ververst? Dan is de
  // fire-and-forget push naar Supabase misschien nog niet aangekomen.
  // Vertrouw dan de lokale cache i.p.v. de (mogelijk nog stale) remote-
  // rijen terug te plakken — de caller valt terug op z'n eigen
  // localStorage-copy en pusht die opnieuw om te reconciliëren.
  if (withinLocalWriteLock()) return null
  if (!await getCurrentUserId()) return null
  const { data: sections, error: sErr } = await supabase
    .from('todo_sections').select('*').order('position')
  if (sErr || !sections || sections.length === 0) return null
  const { data: items, error: iErr } = await supabase
    .from('todo_items').select('*').order('position')
  if (iErr || !items) return null

  const itemsBySection = new Map<string, TodoItem[]>()
  for (const r of items as ItemRow[]) {
    const arr = itemsBySection.get(r.section_id) ?? []
    arr.push({
      id:         r.id,
      text:       r.text,
      done:       r.done,
      projectRef: r.project_ref ?? undefined,
    })
    itemsBySection.set(r.section_id, arr)
  }

  return (sections as SectionRow[]).map(s => ({
    id:    s.id,
    title: s.title,
    emoji: s.emoji,
    items: itemsBySection.get(s.id) ?? [],
  }))
}

/** Push everything up. Used as the seed when remote is empty, and on
 *  every saveSections call. Diffs deletions via id-set comparison. */
export async function pushToRemote(sections: Section[]): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false

  const sectionRows = sections.map((s, i) => ({
    id: s.id, title: s.title, emoji: s.emoji ?? '📋', position: i,
  }))
  if (sectionRows.length > 0) {
    const { error } = await supabase
      .from('todo_sections')
      .upsert(sectionRows, { onConflict: 'id' })
    if (error) return false
  }

  const itemRows: { id: string; section_id: string; text: string; done: boolean; position: number; project_ref: ProjectLink | null }[] = []
  for (const s of sections) {
    s.items.forEach((it, idx) => {
      itemRows.push({
        id:          it.id,
        section_id:  s.id,
        text:        it.text,
        done:        it.done,
        position:    idx,
        project_ref: it.projectRef ?? null,
      })
    })
  }
  if (itemRows.length > 0) {
    const { error } = await supabase
      .from('todo_items')
      .upsert(itemRows, { onConflict: 'id' })
    if (error) return false
  }

  // Verwijder ALLEEN items/secties die de gebruiker hier expliciet heeft
  // verwijderd (bijgehouden door markItemDeleted / deleteSection in
  // app/todos/page.tsx) — niet "alles wat niet in mijn huidige lokale
  // array staat". Dat laatste leek een veilige diff, maar sloeg elke
  // save plat alsnog terug als "verwijderd" wat een ANDER tabblad/
  // toestel had toegevoegd en deze tab nog niet had gepulld: een save
  // hier kon dus stilletjes werk van elders wegvagen. Expliciete
  // deletion-lijsten kunnen nooit per ongeluk iets raken dat niet
  // door DEZE gebruiker met een kruisje is weggeklikt.
  const deletedItemIds = [...loadIdSet(DELETED_ITEM_IDS_KEY)]
  if (deletedItemIds.length > 0) {
    const { error } = await supabase.from('todo_items').delete().in('id', deletedItemIds)
    if (!error) { try { localStorage.removeItem(DELETED_ITEM_IDS_KEY) } catch {} }
  }
  const deletedSectionIds = [...loadIdSet(DELETED_SECTION_IDS_KEY)]
  if (deletedSectionIds.length > 0) {
    await supabase.from('todo_sections').delete().in('id', deletedSectionIds)
    // 'yoko-todos-deleted-sections' blijft ook staan voor de auto-seed-
    // skip-check in page.tsx (voorkomt dat een verwijderd yoko-crew-lid
    // meteen weer terugkomt) — dus NIET verwijderen na een succesvolle
    // Supabase-delete, in tegenstelling tot de item-ids hierboven.
  }
  return true
}

function loadIdSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
// Lokale-mutatie-lock: tijdens en enkele seconden na een eigen push
// negeren we pulls (zowel de realtime schedulePull als de initiële pull
// op page-load). Anders haalt een pull binnen dat venster de oude state
// op — vóór onze eigen upsert in Supabase is doorgevoerd — en plakt die
// terug over wat we net lokaal wijzigden (bv. een net afgevinkt todo-item
// dat na een refresh weer 'open' lijkt).
// In-memory ÉN localStorage: de module-var reset naar 0 bij een hard
// page-refresh, dus zonder de localStorage-kopie zou de lock exact het
// scenario missen waarvoor-ie bedoeld is.
let lastLocalWriteAt = 0
// 5s bleek te kort: "vinkje zetten → nieuw tabblad open → naar /todos
// navigeren" kost in de praktijk makkelijk 10-15s, en viel dus buiten
// het venster — de pull in de nieuwe tab plakte dan alsnog de oude
// (nog niet bevestigd-gepushte) staat terug.
const LOCAL_WRITE_LOCK_MS = 15000
const LAST_WRITE_KEY = 'yoko-todos-last-write-at'

function markLocalWrite(): void {
  lastLocalWriteAt = Date.now()
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LAST_WRITE_KEY, String(lastLocalWriteAt)) } catch {}
}

function withinLocalWriteLock(): boolean {
  if (Date.now() - lastLocalWriteAt < LOCAL_WRITE_LOCK_MS) return true
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(LAST_WRITE_KEY)
    return !!raw && Date.now() - Number(raw) < LOCAL_WRITE_LOCK_MS
  } catch { return false }
}

function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(async () => {
    pullTimer = null
    const remote = await pullFromRemote()
    if (!remote) return
    // Mergen i.p.v. overschrijven — zie mergeSections-comment. Een
    // realtime-pull triggert op ELKE wijziging (ook van andere users),
    // en mag dus nooit lokaal nog-niet-bevestigde staat wegvegen.
    const merged = mergeSections(loadSections([]), remote)
    writeCache(merged)
  }, 400)
}

export function subscribeRemoteTodos(): () => void {
  if (!supabase) return () => {}
  if (channel) return () => {}
  channel = supabase.channel('todos:all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items' },    () => schedulePull())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_sections' }, () => schedulePull())
    .subscribe()
  return () => {
    if (supabase && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
