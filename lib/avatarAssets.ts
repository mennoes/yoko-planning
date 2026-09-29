const STATIC_AVATAR_IDS = new Set(['menno', 'vincent', 'odette', 'anne-fleur'])

// Versie voorkomt dat browsers/CDN's na een fotovervanging de oude jpg uit
// cache blijven tonen. Vincent is bewust gepind op de door Menno aangeleverde
// teamfoto: die moet ook zichtbaar blijven wanneer een oude profiel-URL stuk
// of leeg is.
const STATIC_AVATAR_VERSION = '20260929-2'

export function hasStaticAvatar(memberId: string): boolean {
  return STATIC_AVATAR_IDS.has(memberId)
}

export function staticAvatarUrl(memberId: string): string | null {
  return hasStaticAvatar(memberId)
    ? `/team/${memberId}.jpg?v=${STATIC_AVATAR_VERSION}`
    : null
}

export function pinnedStaticAvatarUrl(memberId: string): string | null {
  return memberId === 'vincent' ? staticAvatarUrl(memberId) : null
}
