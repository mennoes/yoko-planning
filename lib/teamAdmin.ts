// Zelfde beheerders als bij Budget/Omzet. Houd de controle ook op de server:
// alleen een verborgen knop in de UI is geen autorisatie.
const TEAM_ADMIN_IDS = new Set(['menno', 'vincent'])

export function isTeamAdmin(memberId: string | null | undefined): boolean {
  return !!memberId && TEAM_ADMIN_IDS.has(memberId)
}
