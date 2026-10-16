export const START_DATE_META_PREFIX = '__team_start_date__:'
export const TEAM_GROUP_META_PREFIX = '__team_group__:'
export const TEAM_PHOTO_META_PREFIX = '__team_photo__:'

// Metadata-rijen liften mee op `team_members_extra` (startdatums, groepen,
// profielfoto's). Ze hebben allemaal de vorm `__<soort>__:<id>` en mogen
// nooit als teamlid in een lijst belanden — anders verschijnt er bv. een
// "Profielfoto"-collega met 0 u/w en een base64-string als mailadres.
// Daarom matchen we op het patroon en niet op een vaste opsomming: een
// nieuwe metadata-soort is dan automatisch óók uitgesloten.
const META_ID_PATTERN = /^__[a-z0-9_]+__:/

export function isTeamMetadataId(id: string): boolean {
  return META_ID_PATTERN.test(id)
}
