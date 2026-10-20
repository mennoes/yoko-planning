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

/**
 * Schaal een verdeling mee met een nieuw totaal.
 *
 * Zet je de uren van een klus van 20 naar 40, dan verdubbelt ieders
 * aandeel en blijven de verhoudingen — en dus de taart en de percentages
 * — precies gelijk. Zonder dit bleef de verdeling op de oude uren staan:
 * de taart klopte niet meer met het totaal en iedereens percentage zakte.
 *
 * Het afrondingsrestje gaat naar de grootste deler, zodat de som exact op
 * het nieuwe totaal uitkomt en de taart niet gaat driften.
 */
export function scaleOwnerHours(
  current: Record<string, number>,
  newTotal: number,
): Record<string, number> {
  const paren = Object.entries(current ?? {})
    .map(([id, waarde]) => [id, Math.max(0, Number(waarde) || 0)] as const)
  if (paren.length === 0) return {}

  const totaal = Math.max(0, Number(newTotal) || 0)
  const som = paren.reduce((acc, [, waarde]) => acc + waarde, 0)

  // Stond alles op nul, dan is er geen verhouding om te bewaren: gelijk op.
  if (som <= 0) {
    const per = round1(totaal / paren.length)
    const gelijk = Object.fromEntries(paren.map(([id]) => [id, per]))
    gelijk[paren[0][0]] = round1(per + round1(totaal - per * paren.length))
    return gelijk
  }

  const factor = totaal / som
  const next = Object.fromEntries(paren.map(([id, waarde]) => [id, round1(waarde * factor)]))
  const nieuweSom = Object.values(next).reduce((acc, waarde) => acc + waarde, 0)
  const rest = round1(totaal - nieuweSom)
  if (Math.abs(rest) >= 0.1) {
    const grootste = Object.entries(next).sort((a, b) => b[1] - a[1])[0]
    if (grootste) next[grootste[0]] = round1(grootste[1] + rest)
  }
  return next
}
