export type UserProfile = {
  memberId: string   // matches id in team.json
  name:     string
  color:    string
  photo:    string | null   // base64 data-URL of cropped avatar
}

const KEY = 'yoko-profile'

export function loadProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as UserProfile) : null
  } catch { return null }
}

export function saveProfile(p: UserProfile): void {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function clearProfile(): void {
  localStorage.removeItem(KEY)
}
