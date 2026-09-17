export const START_DATE_META_PREFIX = '__team_start_date__:'

export function isTeamMetadataId(id: string): boolean {
  return id.startsWith(START_DATE_META_PREFIX)
}
