// Per-member photo storage (base64 data URL) in localStorage
const KEY = 'yoko-team-photos'

function load(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function save(photos: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(photos))
}

export function getTeamPhoto(memberId: string): string | null {
  return load()[memberId] ?? null
}

export function setTeamPhoto(memberId: string, dataUrl: string) {
  const photos = load()
  photos[memberId] = dataUrl
  save(photos)
}

export function removeTeamPhoto(memberId: string) {
  const photos = load()
  delete photos[memberId]
  save(photos)
}

export function getAllTeamPhotos(): Record<string, string> {
  return load()
}
