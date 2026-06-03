// Cache van Vrij-dagen per teamlid, afgeleid uit de huidige board-projecten.
// Wordt door Home/Planning gevuld zodra projecten geladen zijn; de
// workload-calculatie raadpleegt 'm zonder prop-drilling.
//
// Een 'Vrij'-event in iemands agenda (vakantie, verlof, ziek, etc) telt voor
// die persoon als off-day → workload-distributie skipt die dag, zodat de
// uren naar andere werkdagen rollen.

import { isVrijTitle } from './workloadCategory'

export type VrijDayMap = Map<string, Set<string>>   // memberId → set of 'YYYY-MM-DD'

let cache: VrijDayMap = new Map()

function localIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function setVrijDaysFromProjects(projects: Array<{
  ownerIds: string[]
  startDate: string | null
  endDate:   string | null
  name:      string
  group?:    string | null
}>): void {
  const next: VrijDayMap = new Map()
  for (const p of projects) {
    if (!p.startDate) continue
    const isVrij = isVrijTitle(p.name) || ((p.group ?? '').toLowerCase()).includes('vrij')
    if (!isVrij) continue
    const owners = (p.ownerIds ?? []).filter(o => o && o !== 'unassigned')
    if (owners.length === 0) continue
    const s = new Date(p.startDate)
    const e = p.endDate ? new Date(p.endDate) : new Date(p.startDate)
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const iso = localIso(d)
      for (const owner of owners) {
        let set = next.get(owner)
        if (!set) { set = new Set(); next.set(owner, set) }
        set.add(iso)
      }
    }
  }
  cache = next
}

export function isVrijDayForMember(memberId: string, date: Date): boolean {
  const set = cache.get(memberId)
  if (!set) return false
  return set.has(localIso(date))
}
