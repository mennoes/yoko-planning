import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

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

// ─── Doc folders (subfolders inside the Documenten section) ──────────────────
export function loadDocFolders(): DocFolder[] {
  if (typeof window === 'undefined') return []
  try { const s = localStorage.getItem(FOLDERS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

export function saveDocFolders(folders: DocFolder[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
}

export function loadPage(id: string): PageDoc | null {
  if (typeof window === 'undefined') return null
  try {
    const s = localStorage.getItem(PREFIX + id)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function savePage(doc: PageDoc): void {
  if (typeof window === 'undefined') return
  writeLocal(doc)
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  // Fire-and-forget remote push
  pushPageToRemote(doc).catch(() => { /* offline-tolerant */ })
}

export function deletePage(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PREFIX + id)
  const ids = loadRecentPageIds().filter(i => i !== id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
  deletePageRemote(id).catch(() => {})
}

export function loadRecentPageIds(): string[] {
  if (typeof window === 'undefined') return []
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
  localStorage.setItem(PREFIX + doc.id, JSON.stringify(doc))
  const ids = loadRecentPageIds().filter(id => id !== doc.id)
  ids.unshift(doc.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
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
