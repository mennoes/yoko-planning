export type PageDoc = {
  id: string
  title: string
  content: string
  emoji: string
  createdAt: string
  updatedAt: string
}

const PREFIX     = 'yoko-page-'
const RECENT_KEY = 'yoko-recent-pages'
const MAX_RECENT = 20

export function loadPage(id: string): PageDoc | null {
  if (typeof window === 'undefined') return null
  try {
    const s = localStorage.getItem(PREFIX + id)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function savePage(doc: PageDoc): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREFIX + doc.id, JSON.stringify(doc))
  // Update recents index
  const ids = loadRecentPageIds().filter(id => id !== doc.id)
  ids.unshift(doc.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
}

export function deletePage(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PREFIX + id)
  const ids = loadRecentPageIds().filter(i => i !== id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  window.dispatchEvent(new CustomEvent('yoko-pages-update'))
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
