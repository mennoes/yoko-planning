export type TodayMember = {
  id: string
  name: string
  yoko: boolean
  activeToday: boolean
}
export type TodaySection = { id: string; name: string; memberIds: string[] }

/** Custom groups take precedence over the member's Yoko/freelance kind. */
export function teamTodaySections(
  members: TodayMember[], sections: TodaySection[], visibility: Record<string, boolean> = {}, all = false,
) {
  const custom = sections.filter(section => !section.id.startsWith('__'))
  const membership = new Map<string, string>()
  for (const section of custom) for (const id of section.memberIds) {
    if (!membership.has(id)) membership.set(id, section.id)
  }
  return sections.filter(section => section.id !== '__inactive__').map(section => ({
    id: section.id,
    name: section.id === '__freelance__' ? 'Freelancers vandaag' : section.name,
    members: members.filter(member => {
      if (member.id === 'unassigned') return false
      const customId = membership.get(member.id)
      const groupId = customId ?? (member.yoko ? '__yoko__' : '__freelance__')
      const visible = visibility[section.id] !== false && (!!customId || member.yoko || member.activeToday)
      return groupId === section.id && (all || visible)
    }),
  })).filter(section => section.members.length > 0)
}

export function parseTeamTodayVisibility(raw: string | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'))
  } catch { return {} }
}
