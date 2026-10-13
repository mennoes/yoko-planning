const round1 = (value: number) => Math.round(value * 10) / 10

/** Maak een opgeslagen verdeling passend bij de geselecteerde owners.
 * Een geselecteerde owner met 0 uur is geen bruikbare verdeling: verdeel in
 * dat geval gelijk. Wie echt niet meedoet hoort uit de ownerselectie. */
export function normalizeOwnerHours(
  ownerIds: string[],
  totalHours: number,
  stored?: Record<string, number>,
): Record<string, number> {
  const ids = [...new Set(ownerIds.filter(id => id && id !== 'unassigned'))]
  if (ids.length === 0) return {}
  const total = Math.max(0, Number(totalHours) || 0)
  const raw = Object.fromEntries(ids.map(id => [id, Math.max(0, Number(stored?.[id]) || 0)]))
  if (total <= 0) return raw
  const rawSum = Object.values(raw).reduce((sum, hours) => sum + hours, 0)
  if (rawSum <= 0 || ids.some(id => raw[id] <= 0)) {
    const equal = round1(total / ids.length)
    const next = Object.fromEntries(ids.map(id => [id, equal]))
    next[ids[0]] = round1(next[ids[0]] + round1(total - equal * ids.length))
    return next
  }
  const factor = total / rawSum
  const next = Object.fromEntries(ids.map(id => [id, round1(raw[id] * factor)]))
  const sum = Object.values(next).reduce((acc, hours) => acc + hours, 0)
  next[ids[0]] = round1(next[ids[0]] + round1(total - sum))
  return next
}

/** Wijzig één eigenaar en verdeel het restant over de andere eigenaren. */
export function rebalanceOwnerHours(
  ownerIds: string[],
  current: Record<string, number>,
  totalHours: number,
  editedOwnerId: string,
  editedHours: number,
): Record<string, number> {
  const ids = [...new Set(ownerIds.filter(id => id && id !== 'unassigned'))]
  if (!ids.includes(editedOwnerId)) return { ...current }

  const total = Math.max(0, Number(totalHours) || 0)
  const target = Math.min(total, Math.max(0, Number(editedHours) || 0))
  const others = ids.filter(id => id !== editedOwnerId)
  const next: Record<string, number> = { [editedOwnerId]: round1(target) }
  if (others.length === 0) return next

  const remaining = Math.max(0, total - target)
  const otherSum = others.reduce((sum, id) => sum + Math.max(0, Number(current[id]) || 0), 0)
  for (const id of others) {
    const share = otherSum > 0
      ? Math.max(0, Number(current[id]) || 0) / otherSum
      : 1 / others.length
    next[id] = round1(remaining * share)
  }

  const sum = Object.values(next).reduce((acc, value) => acc + value, 0)
  const remainder = round1(total - sum)
  if (Math.abs(remainder) >= 0.1) next[others[0]] = round1(next[others[0]] + remainder)
  return next
}
