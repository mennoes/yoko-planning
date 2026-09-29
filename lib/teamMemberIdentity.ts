export const START_DATE_META_PREFIX = '__team_start_date__:'
export const TEAM_GROUP_META_PREFIX = '__team_group__:'

export function isTeamMetadataId(id: string): boolean {
  return id.startsWith(START_DATE_META_PREFIX) || id.startsWith(TEAM_GROUP_META_PREFIX)
}
