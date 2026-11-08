import type { BoardItem, SubItem } from './boards'

export function timelineEffort(item: Pick<BoardItem, 'estHours' | 'subitems'>) {
  const rows = item.subitems?.length ? item.subitems : [item]
  const hours = rows.reduce((sum, row) => sum + Math.max(0, Number(row.estHours) || 0), 0)
  return { hours, missing: rows.filter(row => !(Number(row.estHours) > 0)).length }
}

export function isWaitingStatus(status: string): boolean {
  return /^(wachten|wacht op|waiting|awaiting)(\b|$)/i.test(status.trim())
}

export function nextClientMoment(subitems: SubItem[] | undefined, today: string) {
  return subitems?.filter(s => s.deadline && s.deadline >= today && s.status !== 'Done')
    .sort((a,b) => a.deadline!.localeCompare(b.deadline!))[0]
}
