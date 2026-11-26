import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

// De vier oorspronkelijke categorieën blijven de standaard, maar ideeën
// mogen ook een zelfgekozen categorienaam bewaren.
export type IdeaCategory = string
export type IdeaStatus = 'open' | 'doing' | 'done'

export type IdeaItem = {
  id: string
  title: string
  body: string
  category: IdeaCategory
  color: string
  status: IdeaStatus
  authorId: string | null
  authorName: string | null
  claimedBy: string | null
  claimedName: string | null
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'yoko-ideas-v1'
const UPDATE_EVENT = 'yoko-ideas-update'

const STATUSES: IdeaStatus[] = ['open', 'doing', 'done']

type IdeaRow = {
  id: string
  title: string
  body: string | null
  category: string
  color: string
  status: string
  author_id: string | null
  author_name: string | null
  claimed_by: string | null
  claimed_name: string | null
  created_at: string
  updated_at: string
}

function rowToIdea(row: IdeaRow): IdeaItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    category: row.category?.trim() || 'inspiratie',
    color: row.color || '#fff0a8',
    status: STATUSES.includes(row.status as IdeaStatus) ? row.status as IdeaStatus : 'open',
    authorId: row.author_id,
    authorName: row.author_name,
    claimedBy: row.claimed_by,
    claimedName: row.claimed_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function ideaToRow(item: IdeaItem): IdeaRow {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    category: item.category,
    color: item.color,
    status: item.status,
    author_id: item.authorId,
    author_name: item.authorName,
    claimed_by: item.claimedBy,
    claimed_name: item.claimedName,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }
}

function readCache(): IdeaItem[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeCache(items: IdeaItem[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {}
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
}

export function loadIdeas(): IdeaItem[] {
  return readCache()
}

export function onIdeasChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UPDATE_EVENT, handler)
  return () => window.removeEventListener(UPDATE_EVENT, handler)
}

export async function pullIdeas(): Promise<boolean> {
  if (!supabase || !await getCurrentUserId()) return false
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error || !data) return false
  writeCache((data as IdeaRow[]).map(rowToIdea))
  return true
}

export async function createIdea(input: {
  title: string
  body?: string
  category: IdeaCategory
  color: string
  authorId: string | null
  authorName: string | null
}): Promise<IdeaItem> {
  const now = new Date().toISOString()
  const item: IdeaItem = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    body: input.body?.trim() ?? '',
    category: input.category.trim() || 'inspiratie',
    color: input.color,
    status: 'open',
    authorId: input.authorId,
    authorName: input.authorName,
    claimedBy: null,
    claimedName: null,
    createdAt: now,
    updatedAt: now,
  }
  writeCache([item, ...readCache()])
  if (supabase && await getCurrentUserId()) {
    await supabase.from('ideas').upsert(ideaToRow(item))
  }
  return item
}

export async function updateIdea(id: string, patch: Partial<Omit<IdeaItem, 'id' | 'createdAt'>>): Promise<void> {
  const current = readCache().find(item => item.id === id)
  if (!current) return
  const next: IdeaItem = { ...current, ...patch, updatedAt: new Date().toISOString() }
  writeCache(readCache().map(item => item.id === id ? next : item))
  if (supabase && await getCurrentUserId()) {
    await supabase.from('ideas').upsert(ideaToRow(next))
  }
}

export async function deleteIdea(id: string): Promise<void> {
  writeCache(readCache().filter(item => item.id !== id))
  if (supabase && await getCurrentUserId()) {
    await supabase.from('ideas').delete().eq('id', id)
  }
}

let ideasChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null

function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullIdeas().catch(() => {})
  }, 250)
}

export function subscribeRemoteIdeas(): () => void {
  if (!supabase || ideasChannel) return () => {}
  ideasChannel = supabase.channel('ideas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ideas' }, schedulePull)
    .subscribe()
  return () => {
    if (supabase && ideasChannel) supabase.removeChannel(ideasChannel)
    ideasChannel = null
  }
}
