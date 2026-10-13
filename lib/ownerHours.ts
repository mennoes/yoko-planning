const round1 = (value: number) => Math.round(value * 10) / 10

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
