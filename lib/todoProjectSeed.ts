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
import { isVrijTitle } from './workloadCategory'
import yokoRaw       from '@/data/boards/yoko.json'
import pnpRaw        from '@/data/boards/pnp.json'
import nederlandRaw  from '@/data/boards/nederland.json'
import vlaanderenRaw from '@/data/boards/vlaanderen.json'
import dienjaarRaw   from '@/data/boards/dienjaar.json'

export type ProjectSeedLink = {
  board:  string
  itemId: string
  name:   string
}

const RAW: Record<string, { groups: BoardGroup[] }> = {
  yoko:       yokoRaw       as { groups: BoardGroup[] },
  pnp:        pnpRaw        as { groups: BoardGroup[] },
  nederland:  nederlandRaw  as { groups: BoardGroup[] },
  vlaanderen: vlaanderenRaw as { groups: BoardGroup[] },
  dienjaar:   dienjaarRaw   as { groups: BoardGroup[] },
}

export function loadMyOpenProjects(memberId: string): ProjectSeedLink[] {
  if (typeof window === 'undefined') return []
  const today = new Date().toISOString().slice(0, 10)
  const out: ProjectSeedLink[] = []
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
        if (isVrijTitle(item.name as string)) continue
        const parentOwnerIds = Array.isArray(item.ownerIds) ? item.ownerIds : []
        const parentOwns = parentOwnerIds.includes(memberId)
        const end = item.endDate ?? item.startDate
        const parentExpired = end && end < today
        if (parentOwns && !parentExpired) {
          out.push({ board, itemId: item.id, name: item.name })
        }
        // Subitem-todos: alleen wanneer 't subitem EXPLICIET aan deze
        // member is toegewezen ÉN de parent niet (anders dekt de parent-
        // entry 't al). Voorkomt de oude lawine van automatische
        // subitem-todos terwijl iemand wel hun specifieke subitem
        // ziet zoals 'n boekomslag of episode.
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
          // Parent-context op tweede regel — renderer splits op '\n'.
          out.push({ board, itemId: `${item.id}__si${idx}`,
            name: `${subName}\n↳ ${item.name}` })
        })
      }
    }
  }
  return out
}
