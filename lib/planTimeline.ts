import type { AiItemPlan, AiSubitemPlan } from './aiPlan'
import { werkdagenIn, verplaatsStap, rekStap, UREN_PER_DAG } from './sjabloonPlan'

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000)
}
export function endAfterWorkdays(start: string, count: number): string {
  let end = verplaatsStap(start, start, 0).startDate
  for (let remaining = Math.max(1, Math.round(count)) - 1; remaining > 0;) {
    end = addDays(end, 1)
    if (werkdagenIn(end, end)) remaining--
  }
  return end
}
export function updatePlanSteps(plan: AiItemPlan, subitems: AiSubitemPlan[]): AiItemPlan {
  const dates = subitems.flatMap(s => [s.startDate, s.endDate]).filter((d): d is string => !!d)
  return { ...plan, subitems,
    ...(dates.length ? { startDate: dates.reduce((a,b) => a < b ? a : b), endDate: dates.reduce((a,b) => a > b ? a : b) } : {}),
    estHours: subitems.reduce((sum,s) => sum + s.estHours, 0),
  }
}
/** Parent resizing scales child offsets and durations in working days; moving preserves effort. */
export function changePlanPeriod(plan: AiItemPlan, index: number, kind: 'move' | 'start' | 'end' | 'days', amount: number): AiItemPlan {
  const row = index < 0 ? plan : plan.subitems[index]
  if (!row?.startDate || !row.endDate || !Number.isFinite(amount)) return plan
  const period = kind === 'days'
    ? { startDate: row.startDate, endDate: endAfterWorkdays(row.startDate, Math.min(365, Math.max(1, amount))) }
    : kind === 'move' ? verplaatsStap(row.startDate, row.endDate, amount)
      : rekStap(row.startDate, row.endDate, kind === 'start' ? 'start' : 'eind', amount)
  const estHours = werkdagenIn(period.startDate, period.endDate) * UREN_PER_DAG
  if (index >= 0) return updatePlanSteps(plan, plan.subitems.map((s,i) => i === index ? { ...s, ...period, estHours } : s))
  const oldLength = Math.max(1, werkdagenIn(row.startDate, row.endDate))
  const newLength = Math.max(1, werkdagenIn(period.startDate, period.endDate))
  const subitems = plan.subitems.map(s => {
    if (!s.startDate || !s.endDate) return s
    const offset = Math.max(0, werkdagenIn(row.startDate!, s.startDate) - 1)
    const endOffset = Math.max(offset + 1, werkdagenIn(row.startDate!, s.endDate))
    const first = Math.min(newLength - 1, Math.round(offset * newLength / oldLength))
    const last = Math.min(newLength, Math.max(first + 1, Math.round(endOffset * newLength / oldLength)))
    const startDate = endAfterWorkdays(period.startDate, first + 1)
    const endDate = endAfterWorkdays(period.startDate, last)
    return { ...s, startDate, endDate, estHours: kind === 'move' ? s.estHours : werkdagenIn(startDate, endDate) * UREN_PER_DAG }
  })
  return { ...plan, ...period, subitems, estHours: subitems.length ? subitems.reduce((sum,s) => sum + s.estHours, 0) : estHours }
}
