// These fields belong to server-managed app_metadata, never user_metadata
// or the editable display profile.
export type AccountTeamRole = 'team' | 'production_intern' | 'research_intern'
export const ACCOUNT_TEAM_ROLES: Record<AccountTeamRole, string> = {
  team: 'Teamlid', production_intern: 'Productiestage', research_intern: 'Onderzoeksstage',
}
export function accountAccess(metadata: Record<string, unknown> | undefined) {
  return metadata?.team_role === 'team' && metadata?.accounts_access === true
}
export function accountAccessAdmin(metadata: Record<string, unknown> | undefined) {
  return accountAccess(metadata) && metadata?.accounts_admin === true
}
export function accountTeamRole(value: unknown): AccountTeamRole {
  return value === 'production_intern' || value === 'research_intern' ? value : 'team'
}
