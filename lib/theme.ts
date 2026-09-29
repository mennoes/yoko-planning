export type ThemePreference = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

// Studio Yoko / Amsterdam. Zo is automatische weergave nauwkeurig zonder
// locatiegegevens op te vragen of naar een externe weer-API te sturen.
const LATITUDE = 52.3676
const LONGITUDE = 4.9041
const DAY_MS = 86_400_000
const J1970 = 2440588
const J2000 = 2451545
const RAD = Math.PI / 180

function toJulian(date: Date) { return date.valueOf() / DAY_MS - 0.5 + J1970 }
function fromJulian(j: number) { return new Date((j + 0.5 - J1970) * DAY_MS) }
function toDays(date: Date) { return toJulian(date) - J2000 }
function solarMeanAnomaly(d: number) { return RAD * (357.5291 + 0.98560028 * d) }
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return M + C + RAD * 102.9372 + Math.PI
}
function declination(L: number) { return Math.asin(Math.sin(L) * Math.sin(RAD * 23.4397)) }
function julianCycle(d: number, lw: number) { return Math.round(d - 0.0009 - lw / (2 * Math.PI)) }
function approxTransit(Ht: number, lw: number, n: number) { return 0.0009 + (Ht + lw) / (2 * Math.PI) + n }
function solarTransitJ(ds: number, M: number, L: number) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
}

export function getSolarTimes(date = new Date()): { sunrise: Date; sunset: Date } {
  const localNoon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  const lw = -LONGITUDE * RAD
  const phi = LATITUDE * RAD
  const d = toDays(localNoon)
  const n = julianCycle(d, lw)
  const ds = approxTransit(0, lw, n)
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L)
  const Jnoon = solarTransitJ(ds, M, L)
  // -0.833° corrigeert voor atmosferische refractie en de zonneschijf.
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec))
  const w = Math.acos(Math.max(-1, Math.min(1, cosW)))
  const a = approxTransit(w, lw, n)
  const Jset = solarTransitJ(a, M, L)
  return { sunrise: fromJulian(Jnoon - (Jset - Jnoon)), sunset: fromJulian(Jset) }
}

export function resolveTheme(preference: ThemePreference, now = new Date()): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  const { sunrise, sunset } = getSolarTimes(now)
  return now >= sunrise && now < sunset ? 'light' : 'dark'
}

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'auto'
  const value = window.localStorage.getItem('theme')
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto'
}

export function applyThemePreference(preference: ThemePreference, now = new Date()): ResolvedTheme {
  const resolved = resolveTheme(preference, now)
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', resolved)
  return resolved
}

export function setThemePreference(preference: ThemePreference): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('theme', preference)
    window.dispatchEvent(new CustomEvent('yoko-theme-change', { detail: preference }))
  }
  applyThemePreference(preference)
}

export function nextSolarTransition(now = new Date()): Date {
  const today = getSolarTimes(now)
  if (now < today.sunrise) return today.sunrise
  if (now < today.sunset) return today.sunset
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return getSolarTimes(tomorrow).sunrise
}
