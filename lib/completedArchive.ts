// Archive by the visible timeline date, never by when someone last edited a row.
export function splitCompletedArchive<T>(items: T[], dateOf: (item: T) => string | null, now = new Date(), newestFirst = true) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [year, month, day] = today.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 3, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cutoff = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10)
  const dated = items.map(item => ({ item, date: dateOf(item)?.slice(0, 10) ?? null }))
  if (newestFirst) dated.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return {
    recent: dated.filter(row => !row.date || row.date >= cutoff).map(row => row.item),
    older: dated.filter(row => row.date && row.date < cutoff).map(row => row.item),
    cutoff,
  }
}
