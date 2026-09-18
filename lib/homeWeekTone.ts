import { isVrijTitle, type WorkloadCategory } from './workloadCategory'

type Contribution = {
  hours: number
  project: { id: string; name: string; group?: string; source?: string }
}

export function homeWeekTone(
  contributions: Contribution[],
  capacity: number,
  period: 'past' | 'next',
  overrides: Record<string, WorkloadCategory>,
): string {
  const label = period === 'past' ? 'vorige week' : 'volgende week'
  const hours = (kind: 'vrij' | 'work') => contributions.reduce((sum, entry) => {
    // Houd dezelfde Vrij-detectie aan als projectHoursInWeek: het totaalcijfer
    // telt deze uren mee als onbeschikbaar, maar de tekst mag ze niet werk noemen.
    const isFree = overrides[entry.project.id] === 'vrij'
      || isVrijTitle(entry.project.name)
      || (entry.project.group ?? '').toLowerCase().includes('vrij')
    return sum + (isFree === (kind === 'vrij') ? entry.hours : 0)
  }, 0)
  const free = hours('vrij')
  const work = hours('work')
  const fmt = (value: number) => `${Math.round(value * 10) / 10}u`

  if (free > 0) {
    const prefix = period === 'past' ? `${label} had je` : `${label} heb je`
    if (work <= 0) return `${prefix} ${fmt(free)} vrij`
    const total = free + work
    const overlap = total > capacity + 0.05
      ? `; samen ${fmt(total)} op je planning — check de overlap`
      : ''
    return `${prefix} ${fmt(free)} vrij en ${fmt(work)} werk gepland${overlap}`
  }

  if (period === 'past') {
    if (work <= 0) return 'vorige week stond er niets op de planning'
    if (work > capacity * 1.05) return `vorige week was pittig (${fmt(work)} 💪)`
    if (work >= capacity * 0.85) return `vorige week zat lekker vol (${fmt(work)})`
    if (work >= capacity * 0.5) return `vorige week was prima behapbaar (${fmt(work)})`
    return `vorige week was rustig (${fmt(work)})`
  }

  if (work <= 0) return 'volgende week is nog leeg ✨'
  if (work > capacity * 1.05) return `volgende week schiet je over je cap met ${fmt(work)} — pas op je tempo`
  if (work >= capacity * 0.85) return `volgende week wordt vol (${fmt(work)})`
  if (work >= capacity * 0.5) return `volgende week zit prima (${fmt(work)})`
  return `volgende week is wat rustiger (${fmt(work)})`
}
