import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { isOnDemoRoute, DEMO_DOC_FOLDERS, DEMO_PAGES } from './demoFixtures'

export type PageDoc = {
  id: string
  title: string
  content: string
  emoji: string
  createdAt: string
  updatedAt: string
  folderId?: string | null
}

export type DocFolder = {
  id:    string
  name:  string
  emoji?: string
}

const PREFIX     = 'yoko-page-'
const RECENT_KEY = 'yoko-recent-pages'
const FOLDERS_KEY = 'yoko-doc-folders'
const MAX_RECENT = 50

// /demo krijgt een VOLLEDIG gescheiden localStorage-namespace (eigen
// prefix/keys) — nooit de echte 'yoko-page-*'/'yoko-recent-pages' data uit
// een évt. ingelogde sessie in dezelfde browser tonen of overschrijven.
const DEMO_PREFIX      = 'yoko-demo-page-'
const DEMO_RECENT_KEY  = 'yoko-demo-recent-pages'
const DEMO_FOLDERS_KEY = 'yoko-demo-doc-folders'

// Eerste bezoek aan /demo: vul de demo-namespace met wat fixture-content
// zodat 'Documenten' niet leeg oogt (zelfde seed-aanpak als buildDemoBoards()
// voor Planning). Draait maar één keer — daarna bepaalt de eigen sessie
// (of de 'Reset'-knop in DemoShell) de inhoud.
function seedDemoPagesIfNeeded(): void {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(DEMO_RECENT_KEY) !== null) return
  for (const p of DEMO_PAGES) localStorage.setItem(DEMO_PREFIX + p.id, JSON.stringify(p))
  localStorage.setItem(DEMO_RECENT_KEY, JSON.stringify(DEMO_PAGES.map(p => p.id)))
  localStorage.setItem(DEMO_FOLDERS_KEY, JSON.stringify(DEMO_DOC_FOLDERS))
}

// ─── Doc folders (subfolders inside the Documenten section) ──────────────────
export function loadDocFolders(): DocFolder[] {
  if (typeof window === 'undefined') return []
  if (isOnDemoRoute()) {
    seedDemoPagesIfNeeded()
    try { const s = localStorage.getItem(DEMO_FOLDERS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
  }
  try { const s = localStorage.getItem(FOLDERS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function saveDocFolders(folders: DocFolder[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(isOnDemoRoute() ? DEMO_FOLDERS_KEY : FOLDERS_KEY, JSON.stringify(folders))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
}

export function loadPage(id: string): PageDoc | null {
  if (typeof window === 'undefined') return null
  try {
    const s = localStorage.getItem((isOnDemoRoute() ? DEMO_PREFIX : PREFIX) + id)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function savePage(doc: PageDoc): void {
  if (typeof window === 'undefined') return
  writeLocal(doc)
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  // /demo is 100% lokaal — nooit naar de echte, productie-Supabase pushen
  // vanaf de publieke demo-omgeving.
  if (isOnDemoRoute()) return
  // Fire-and-forget remote push
  pushPageToRemote(doc).catch(() => { /* offline-tolerant */ })
}

export function deletePage(id: string): void {
  if (typeof window === 'undefined') return
  const demo = isOnDemoRoute()
  localStorage.removeItem((demo ? DEMO_PREFIX : PREFIX) + id)
  const ids = loadRecentPageIds().filter(i => i !== id)
  localStorage.setItem(demo ? DEMO_RECENT_KEY : RECENT_KEY, JSON.stringify(ids))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  if (demo) return
  deletePageRemote(id).catch(() => {})
}

export function loadRecentPageIds(): string[] {
  if (typeof window === 'undefined') return []
  if (isOnDemoRoute()) {
    seedDemoPagesIfNeeded()
    try { const s = localStorage.getItem(DEMO_RECENT_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
  }
  try {
    const s = localStorage.getItem(RECENT_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

export function loadRecentPages(): PageDoc[] {
  return loadRecentPageIds()
    .map(id => loadPage(id))
    .filter((d): d is PageDoc => d !== null)
}

// ─── Remote sync (Supabase) ──────────────────────────────────────────────────
function rowToDoc(r: Record<string, unknown>): PageDoc {
  return {
    id:        String(r.id ?? ''),
    title:     (r.title as string)   ?? '',
    content:   (r.content as string) ?? '',
    emoji:     (r.emoji as string)   ?? '📄',
    createdAt: String(r.created_at ?? new Date().toISOString()),
    updatedAt: String(r.updated_at ?? new Date().toISOString()),
  }
}

function writeLocal(doc: PageDoc) {
  if (typeof window === 'undefined') return
  const demo = isOnDemoRoute()
  localStorage.setItem((demo ? DEMO_PREFIX : PREFIX) + doc.id, JSON.stringify(doc))
  const ids = loadRecentPageIds().filter(id => id !== doc.id)
  ids.unshift(doc.id)
  localStorage.setItem(demo ? DEMO_RECENT_KEY : RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
}

export async function pullPagesFromRemote(): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { data, error } = await supabase.from('pages').select('*').order('updated_at', { ascending: false }).limit(MAX_RECENT)
  if (error || !data) return false
  // Replace cache with remote
  const ids: string[] = []
  for (const r of data) {
    const doc = rowToDoc(r as Record<string, unknown>)
    localStorage.setItem(PREFIX + doc.id, JSON.stringify(doc))
    ids.push(doc.id)
  }
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  return true
}

export async function pushPageToRemote(doc: PageDoc): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('pages').upsert({
    id:         doc.id,
    title:      doc.title,
    emoji:      doc.emoji,
    content:    doc.content,
    owner_id:   uid,
    updated_at: doc.updatedAt,
  }, { onConflict: 'id' })
  return !error
}

export async function deletePageRemote(id: string): Promise<boolean> {
  if (!supabase) return false
  const uid = await getCurrentUserId()
  if (!uid) return false
  const { error } = await supabase.from('pages').delete().eq('id', id)
  return !error
}

let pagesChannelOn = false
export function subscribeRemotePages(): () => void {
  if (!supabase || pagesChannelOn) return () => {}
  pagesChannelOn = true
  const ch = supabase.channel('public:pages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pages' }, () => {
      // Pull fresh on any remote change
      pullPagesFromRemote()
    })
    .subscribe()
  return () => { pagesChannelOn = false; supabase!.removeChannel(ch) }
}
