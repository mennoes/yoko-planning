// Auto-planner voor de Rewind-groep op het yoko-bord. Zorgt dat er voor
// elke aankomende maand een 'Rewind <maand>' item staat (16u, owner Kars,
// gespreid over de hele maand). Wordt aangeroepen vanuit AppShell zodra
// de app is geladen — idempotent: bestaande items worden niet dubbel
// aangemaakt.

import { loadGroups, saveGroups } from './boardStore'
import type { BoardItem } from './boards'

const NL_MONTHS = [
  'januari','februari','maart','april','mei','juni',
  'juli','augustus','september','oktober','november','december',
]

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ensureRewindItems(monthsAhead = 2): void {
  if (typeof window === 'undefined') return
  const groups = loadGroups('yoko', [])
  const rewindGroup = groups.find(g => g.name.toLowerCase().includes('rewind'))
  if (!rewindGroup) return  // Geen Rewind-groep op het yoko-bord — niks te doen

  const now = new Date()
  const created: BoardItem[] = []

  for (let i = 0; i < monthsAhead; i++) {
    const target = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const month = target.getMonth()
    const year  = target.getFullYear()
    const monthName = NL_MONTHS[month] + ' ' + year

    // Skip als er al een Rewind-item is dat in deze maand begint.
    const alreadyExists = rewindGroup.items.some(it => {
      if (!it.startDate) return false
      const d = new Date(it.startDate)
      if (d.getMonth() !== month || d.getFullYear() !== year) return false
      return it.name.toLowerCase().includes('rewind')
    })
    if (alreadyExists) continue

    const lastDay = new Date(year, month + 1, 0)
    created.push({
      id:        `rewind-${year}-${String(month + 1).padStart(2, '0')}`,
      name:      `Rewind ${monthName}`,
      ownerIds:  ['kars'],
      status:    '',
      startDate: toIso(target),
      endDate:   toIso(lastDay),
      deadline:  null,
      estHours:  16,
      dagen:     2,
    } as BoardItem)
  }

  if (created.length === 0) return

  const nextGroups = groups.map(g => {
    if (g.id !== rewindGroup.id) return g
    return { ...g, items: [...g.items, ...created] }
  })
  saveGroups('yoko', nextGroups)
}
