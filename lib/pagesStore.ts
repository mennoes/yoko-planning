import { supabase } from './supabase'
import { getCurrentUserId } from './sync'
import { isOnDemoRoute } from './demoFixtures'

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

const PREFIX      = 'yoko-page-'
const RECENT_KEY  = 'yoko-recent-pages'
const FOLDERS_KEY = 'yoko-doc-folders'
const MAX_RECENT  = 50
// /demo krijgt een volledig eigen prefix/key — nooit de gedeelde
// 'yoko-page-*'/'yoko-recent-pages' van een échte sessie in dezelfde
// browser lezen óf overschrijven.
function pagePrefix(): string { return isOnDemoRoute() ? 'yoko-demo-page-' : PREFIX }
function recentKey(): string { return isOnDemoRoute() ? 'yoko-demo-recent-pages' : RECENT_KEY }

// ─── Doc folders (subfolders inside the Documenten section) ──────────────────
// /demo krijgt een eigen key — start dus leeg (niet de gedeelde cache van
// een échte sessie in dezelfde browser), maar mappen die je in de demo
// zelf aanmaakt blijven wél gewoon werken/bewaard.
function foldersKey(): string { return isOnDemoRoute() ? 'yoko-demo-doc-folders' : FOLDERS_KEY }

export function loadDocFolders(): DocFolder[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(foldersKey()); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function saveDocFolders(folders: DocFolder[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(foldersKey(), JSON.stringify(folders))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
}

export function loadPage(id: string): PageDoc | null {
  if (typeof window === 'undefined') return null
  try {
    const s = localStorage.getItem(pagePrefix() + id)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function savePage(doc: PageDoc): void {
  if (typeof window === 'undefined') return
  writeLocal(doc)
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  // Fire-and-forget remote push — pushPageToRemote is auth-gated en dus
  // sowieso een no-op op /demo, maar we slaan de aanroep hier ook meteen
  // over.
  if (!isOnDemoRoute()) pushPageToRemote(doc).catch(() => { /* offline-tolerant */ })
}

export function deletePage(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(pagePrefix() + id)
  const ids = loadRecentPageIds().filter(i => i !== id)
  localStorage.setItem(recentKey(), JSON.stringify(ids))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  if (!isOnDemoRoute()) deletePageRemote(id).catch(() => {})
}

export function loadRecentPageIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const s = localStorage.getItem(recentKey())
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
  localStorage.setItem(pagePrefix() + doc.id, JSON.stringify(doc))
  const ids = loadRecentPageIds().filter(id => id !== doc.id)
  ids.unshift(doc.id)
  localStorage.setItem(recentKey(), JSON.stringify(ids.slice(0, MAX_RECENT)))
}

export async function pullPagesFromRemote(): Promise<boolean> {
  if (isOnDemoRoute()) return false
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
  if (isOnDemoRoute()) return () => {}
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
