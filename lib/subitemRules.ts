// Rules die onthouden waar Google-events automatisch als subitem terecht
// moeten komen. Wanneer de gebruiker handmatig een Google-item onder een
// ander item nest, leggen we een regel vast op basis van een genormaliseerde
// titel. De volgende Google-sync (die het volgende episode aanmaakt als
// nieuw top-level item) wordt door applySubitemRules() opgepakt en het
// nieuwe item wordt direct onder dezelfde parent geschoven.
//
// V1 = localStorage-only. Cross-device sync zou via een aparte Supabase-tabel
// kunnen lopen (zie TODO in commit-message).

import type { BoardGroup, BoardItem, SubItem } from './boards'
import { loadGroups, saveGroups, pushBoardToRemote } from './boardStore'
import { getBoardIds } from './boardsRegistry'

export type SubitemRule = {
  pattern:        string  // genormaliseerd
  parentBoardId:  string
  parentItemId:   string
  parentName:     string  // alleen voor debug / UI later
  createdAt:      string
}

const KEY = 'yoko-subitem-rules'

// Strip de delen die per aflevering verschillen: episode-nummers, datums,
// "aflv 02", "(1×)", "ep 3", trailing cijfers, etc. Wat overblijft is een
// stabiele prefix die we als pattern bewaren.
export function normalizeTitle(s: string): string {
  let t = (s ?? '').toLowerCase().trim()
  // "(2×)" of "(3x)" suffix
  t = t.replace(/\(\d+\s*[x×]\)\s*$/u, '')
  // aflv/afl/aflevering/episode/ep/deel/part/vol/nr/no + getal
  t = t.replace(/\b(aflv|afl|aflevering|episode|ep|deel|part|vol|nr|no\.?)\s*\d+\b/giu, '')
  // # of nr-symbool
  t = t.replace(/#\s*\d+/giu, '')
  // trailing reeks zoals "1&2", "3-4", " 02", " s02e01"
  t = t.replace(/\bs\d+e\d+\b/giu, '')
  t = t.replace(/\b\d+\s*[&\-]\s*\d+\b/giu, '')
  t = t.replace(/\b\d{1,3}\b\s*$/u, '')
  // datums (08-05, 8 mei, 2026-05-08)
  t = t.replace(/\b\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?\b/giu, '')
  t = t.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/giu, '')
  t = t.replace(/\b\d{1,2}\s+(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\w*\b/giu, '')
  // dubbele spaties en interpunctie aan rand
  t = t.replace(/[\s ]+/gu, ' ').trim()
  t = t.replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/gu, '')
  return t
}

export function getRules(): SubitemRule[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SubitemRule[]
    return Array.isArray(parsed) ? parsed.filter(r => r && r.pattern && r.parentItemId) : []
  } catch { return [] }
}

function saveRules(rules: SubitemRule[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(KEY, JSON.stringify(rules)) } catch {}
}

export function addRule(itemName: string, parentBoardId: string, parentItemId: string, parentName: string): void {
  const pattern = normalizeTitle(itemName)
  if (!pattern || pattern.length < 3) return  // te kort om uniek te zijn
  const rules = getRules().filter(r => !(r.pattern === pattern && r.parentItemId === parentItemId))
  rules.push({ pattern, parentBoardId, parentItemId, parentName, createdAt: new Date().toISOString() })
  saveRules(rules)
}

export function removeRule(pattern: string): void {
  saveRules(getRules().filter(r => r.pattern !== pattern))
}

function matchRule(name: string, rules: SubitemRule[]): SubitemRule | null {
  const norm = normalizeTitle(name)
  if (!norm) return null
  // Exacte match heeft voorrang; daarna langste startWith-match.
  let best: SubitemRule | null = null
  for (const r of rules) {
    if (r.pattern === norm) return r
    if (norm.startsWith(r.pattern) || r.pattern.startsWith(norm)) {
      if (!best || r.pattern.length > best.pattern.length) best = r
    }
  }
  return best
}

function itemToSubitem(item: BoardItem): SubItem {
  return {
    id:        item.id,
    name:      item.name,
    ownerIds:  item.ownerIds ?? [],
    status:    item.status ?? '',
    startDate: item.startDate ?? null,
    endDate:   item.endDate ?? null,
    // Tijden bewaren bij auto-nesting — anders raakt Week-view in Planning
    // het uur kwijt zodra een Google-event als subitem wordt geplaatst.
    startTime: (item as { startTime?: string | null }).startTime ?? null,
    endTime:   (item as { endTime?:   string | null }).endTime   ?? null,
    externalLink: item.externalLink ?? null,
    meetLink:     (item as { meetLink?: string | null }).meetLink ?? null,
    source:       item.source,
    estHours:  Number(item.estHours) || 0,
  }
}

// Loopt over alle borden, vindt top-level Google-items waarvan de naam matcht
// met een regel en verplaatst die items als subitem onder de geregistreerde
// parent. Pusht alleen de borden die daadwerkelijk veranderden.
export async function applySubitemRules(): Promise<{ moved: number }> {
  const rules = getRules()
  if (rules.length === 0) return { moved: 0 }

  const boardIds = getBoardIds()
  const boards = new Map<string, BoardGroup[]>()
  for (const id of boardIds) boards.set(id, loadGroups(id, []))

  // Vind voor elke regel het parent-item (kan tussen pulls van bord wisselen)
  const parentLocations = new Map<string, { boardId: string; groupId: string; itemIdx: number }>()
  for (const r of rules) {
    const groups = boards.get(r.parentBoardId)
    if (!groups) continue
    let loc: { boardId: string; groupId: string; itemIdx: number } | null = null
    for (const g of groups) {
      const idx = g.items.findIndex(i => i.id === r.parentItemId)
      if (idx >= 0) { loc = { boardId: r.parentBoardId, groupId: g.id, itemIdx: idx }; break }
    }
    if (loc) parentLocations.set(r.parentItemId, loc)
  }

  const dirtyBoards = new Set<string>()
  let moved = 0

  // Sweep elk bord, elk top-level item — als de naam matcht én er een geldige
  // parent bestaat, verplaats het item naar de parent als subitem.
  for (const [boardId, groups] of boards) {
    for (const g of groups) {
      const toRemove: string[] = []
      for (const item of g.items) {
        // Alleen Google-bronnen — handmatige items wil de user zelf nesten.
        if (item.source !== 'google') continue
        // Skip items die al subitems hebben (anders pakt 'ie de parent zelf)
        if ((item.subitems?.length ?? 0) > 0) continue
        const rule = matchRule(item.name, rules)
        if (!rule) continue
        const ploc = parentLocations.get(rule.parentItemId)
        if (!ploc) continue
        // Niet onder zichzelf nesten
        if (ploc.boardId === boardId && ploc.groupId === g.id && g.items[ploc.itemIdx]?.id === item.id) continue
        const parentGroups = boards.get(ploc.boardId)
        if (!parentGroups) continue
        const parentGroup  = parentGroups.find(pg => pg.id === ploc.groupId)
        const parentItem   = parentGroup?.items[ploc.itemIdx]
        if (!parentItem) continue
        const exists = (parentItem.subitems ?? []).some(s => s.id === item.id)
        if (exists) { toRemove.push(item.id); continue }
        parentItem.subitems = [...(parentItem.subitems ?? []), itemToSubitem(item)]
        toRemove.push(item.id)
        dirtyBoards.add(ploc.boardId)
        moved++
      }
      if (toRemove.length > 0) {
        g.items = g.items.filter(i => !toRemove.includes(i.id))
        dirtyBoards.add(boardId)
      }
    }
  }

  if (moved === 0 && dirtyBoards.size === 0) return { moved: 0 }

  // Persist lokaal + push naar Supabase
  for (const id of dirtyBoards) {
    const groups = boards.get(id)
    if (!groups) continue
    saveGroups(id, groups)
    pushBoardToRemote(id, groups).catch(() => {})
  }
  return { moved }
}
