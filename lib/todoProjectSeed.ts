'use client'

// Verzamel de open project-items waar `memberId` eigenaar van is, voor
// gebruik als auto-seed in de to-do-lijst. Gedeeld tussen de To do's-pagina
// en de Home 'Jouw taken'-widget zodat beide identieke openstaande
// projecten tonen, ongeacht of de pagina eerst is bezocht.
//
// Filters:
//  - niet-Google (Google events horen niet in todo's, gebruik de agenda)
//  - status ≠ 'Done' en niet in een 'Done'-groep
//  - niet voorbij de eind-datum (of start-datum als 't enige datum is)
//  - memberId moet in ownerIds zitten (echte eigenaar)

import { loadGroups } from './boardStore'
import type { BoardGroup } from './boards'
import { isVrijTitle, loadCategoryOverrides } from './workloadCategory'
import type { TodoItem } from './todosStore'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'

export type ProjectSeedLink = {
  board:  string
  itemId: string
  name:   string
  startDate?: string | null
  endDate?:   string | null
  status?:    string | null
}

const RAW: Record<string, { groups: BoardGroup[] }> = {
  yoko:       yokoRaw       as { groups: BoardGroup[] },
  pnp:        pnpRaw        as { groups: BoardGroup[] },
  nederland:  nederlandRaw  as { groups: BoardGroup[] },
  vlaanderen: vlaanderenRaw as { groups: BoardGroup[] },
  dienjaar:   dienjaarRaw   as { groups: BoardGroup[] },
}

export function loadAllTodoProjects(): ProjectSeedLink[] {
  if (typeof window === 'undefined') return []
  const out: ProjectSeedLink[] = []
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups)
    for (const g of groups) for (const item of g.items) {
      if (!item.name) continue
      out.push({
        board, itemId: item.id, name: item.name,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
        status: item.status ?? null,
      })
      const subs = (item.subitems as Array<{ name?: string; status?: string; startDate?: string | null; endDate?: string | null }> | undefined) ?? []
      subs.forEach((sub, idx) => {
        out.push({
          board,
          itemId: `${item.id}__si${idx}`,
          name: sub.name ?? item.name,
          startDate: sub.startDate ?? null,
          endDate: sub.endDate ?? sub.startDate ?? null,
          status: sub.status ?? null,
        })
      })
    }
  }
  return out
}

export function loadMyOpenProjects(memberId: string): ProjectSeedLink[] {
  if (typeof window === 'undefined') return []
  const today = new Date().toISOString().slice(0, 10)
  const out: ProjectSeedLink[] = []
  const catOverrides = loadCategoryOverrides()
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups)
    for (const g of groups) {
      const groupName = (g.name ?? '').toLowerCase()
      if (groupName === 'done') continue
      for (const item of g.items) {
        if (!item.name) continue
        if (item.source === 'google') continue
        if ((item.status ?? '').toLowerCase() === 'done') continue
        // Vrij/vakantie items horen niet in todos — geen actie nodig.
        // Check zowel naam-pattern als category-override (gebruiker kan
        // 'm via planning-popup expliciet op 'vrij' zetten).
        const projectId = `${board}__${item.id}`
        if (isVrijTitle(item.name as string)) continue
        if (catOverrides[projectId] === 'vrij') continue
        const parentOwnerIds = Array.isArray(item.ownerIds) ? item.ownerIds : []
        const parentOwns = parentOwnerIds.includes(memberId)
        const end = item.endDate ?? item.startDate
        const parentExpired = end && end < today
        if (parentOwns && !parentExpired) {
          out.push({
            board, itemId: item.id, name: item.name,
            startDate: item.startDate ?? null,
            endDate: item.endDate ?? null,
          })
        }
        const subs = (item.subitems as Array<{ id?: string; name?: string; ownerIds?: string[]; status?: string; startDate?: string | null; endDate?: string | null }> | undefined) ?? []
        if (parentOwns) continue
        subs.forEach((si, idx) => {
          const subOwners = Array.isArray(si.ownerIds) ? si.ownerIds : []
          if (!subOwners.includes(memberId)) return
          if ((si.status ?? '').toLowerCase() === 'done') return
          const subEnd = si.endDate ?? si.startDate
          if (subEnd && subEnd < today) return
          const subName = si.name && si.name.trim().length > 0 ? si.name : item.name
          if (isVrijTitle(subName as string)) return
          const subProjectId = `${board}__${item.id}__si${idx}`
          if (catOverrides[subProjectId] === 'vrij') return
          // Parent-context op tweede regel — renderer splits op '\n'.
          out.push({ board, itemId: `${item.id}__si${idx}`,
            name: `${subName}\n↳ ${item.name}`,
            startDate: si.startDate ?? null,
            endDate: si.endDate ?? si.startDate ?? null,
          })
        })
      }
    }
  }
  return out
}

export function loadDoneTodoProjectKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const out = new Set<string>()
  const today = new Date().toISOString().slice(0, 10)
  for (const [board, raw] of Object.entries(RAW)) {
    const groups = loadGroups(board, raw.groups)
    for (const g of groups) {
      const groupIsDone = (g.name ?? '').toLowerCase() === 'done'
      for (const item of g.items) {
        const parentIsDone = groupIsDone || (item.status ?? '').trim().toLowerCase() === 'done'
        if (parentIsDone) {
          out.add(`${board}:${item.id}`)
        }
        const end = item.endDate ?? item.startDate
        if (end && end < today) out.add(`${board}:${item.id}`)
        const subs = (item.subitems as Array<{ status?: string; startDate?: string | null; endDate?: string | null }> | undefined) ?? []
        subs.forEach((sub, idx) => {
          const subEnd = sub.endDate ?? sub.startDate
          if (
            parentIsDone ||
            (sub.status ?? '').trim().toLowerCase() === 'done' ||
            (subEnd && subEnd < today)
          ) {
            out.add(`${board}:${item.id}__si${idx}`)
          }
        })
      }
    }
  }
  return out
}

export function todoIdentity(todo: TodoItem): string {
  const ref = todo.projectRef
  if (ref?.itemId) return `project:${ref.board}:${ref.itemId}`
  return `text:${todo.text.trim().toLocaleLowerCase('nl-NL').replace(/\s+/g, ' ')}`
}

export function dedupeTodoItems(items: TodoItem[]): TodoItem[] {
  const unique = new Map<string, TodoItem>()
  for (const item of items) {
    const key = todoIdentity(item)
    const existing = unique.get(key)
    if (!existing) unique.set(key, item)
    else if (item.done && !existing.done) unique.set(key, { ...existing, done: true })
  }
  return [...unique.values()]
}

function loadRemovedProjectKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem('yoko-todos-removed-projects')
    return new Set(raw ? JSON.parse(raw) as string[] : [])
  } catch {
    return new Set()
  }
}

// Eén zichtbare persoonlijke takenlijst voor zowel /todos als Home.
// Vult missende open projecten aan, verrijkt bestaande koppelingen met
// actuele datums, dedupliceert, en verbergt gekoppelde projecten die
// inmiddels Done/verlopen/vrij zijn.
export function mergeMemberTodoItems(stored: TodoItem[], memberId: string): TodoItem[] {
  const storedUnique = dedupeTodoItems(stored)
  const existingRefs = new Set(storedUnique.map(todoIdentity))
  const removed = loadRemovedProjectKeys()
  const projects = loadAllTodoProjects()
  const projectsByKey = new Map(projects.map(p => [`${p.board}:${p.itemId}`, p]))
  const childrenByParent = new Map<string, ProjectSeedLink[]>()
  for (const project of projects) {
    const marker = project.itemId.lastIndexOf('__si')
    if (marker <= 0) continue
    const parentKey = `${project.board}:${project.itemId.slice(0, marker)}`
    const children = childrenByParent.get(parentKey) ?? []
    children.push(project)
    childrenByParent.set(parentKey, children)
  }
  const extras: TodoItem[] = loadMyOpenProjects(memberId)
    .filter(p => !existingRefs.has(`project:${p.board}:${p.itemId}`))
    .filter(p => !removed.has(`${p.board}:${p.itemId}`))
    .map(p => ({
      id: `auto-${p.board}-${p.itemId}`,
      text: p.name,
      done: false,
      projectRef: p,
    }))

  const doneKeys = loadDoneTodoProjectKeys()
  const overrides = loadCategoryOverrides()
  const today = new Date().toISOString().slice(0, 10)
  return dedupeTodoItems([...storedUnique, ...extras])
    .map(item => {
      if (!item.projectRef) return item
      const current = projectsByKey.get(`${item.projectRef.board}:${item.projectRef.itemId}`)
      return current ? { ...item, projectRef: { ...item.projectRef, ...current } } : item
    })
    .filter(item => {
      const ref = item.projectRef
      if (ref) {
        if (doneKeys.has(`${ref.board}:${ref.itemId}`)) return false
        if (overrides[`${ref.board}__${ref.itemId}`] === 'vrij') return false
        if (isVrijTitle(ref.name ?? '')) return false
        // Een hoofdproject met concrete subitems is alleen nog een taak
        // zolang minstens één subitem open en actueel/toekomstig is. Deze
        // regel stond voorheen alleen in de renderer van /todos. Daardoor
        // verborg To do's bv. Medialogica, terwijl Home hetzelfde opgeslagen
        // item nog wél liet zien. Centraal filteren houdt beide pagina's
        // werkelijk op dezelfde bron en selectie.
        const children = childrenByParent.get(`${ref.board}:${ref.itemId}`)
        if (children && children.length > 0) {
          const hasRelevantChild = children.some(child =>
            (child.status ?? '').toLowerCase() !== 'done' &&
            (!(child.endDate ?? child.startDate) || (child.endDate ?? child.startDate)! >= today))
          if (!hasRelevantChild) return false
        }
      }
      return !isVrijTitle((item.text ?? '').split('\n')[0] ?? '')
    })
}
