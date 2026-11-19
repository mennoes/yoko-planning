/** Zet de ingelogde persoon vooraan en laat de onderlinge teamvolgorde intact. */
export function currentMemberFirst<T extends { id: string }>(
  members: T[],
  currentMemberId: string | null | undefined,
): T[] {
  if (!currentMemberId) return members
  const ownIndex = members.findIndex(member => member.id === currentMemberId)
  if (ownIndex <= 0) return members
  return [members[ownIndex], ...members.slice(0, ownIndex), ...members.slice(ownIndex + 1)]
}
