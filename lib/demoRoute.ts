// Weten of we op /demo zitten, los van lib/demoFixtures.ts.
//
// De store-modules hebben dit nodig om hun localStorage-sleutel te kiezen
// en om remote calls over te slaan. Ze zouden het uit demoFixtures kunnen
// halen, maar dan hangt elke store aan 453 regels verzonnen borden,
// teamleden en foto's — en daarmee de hele demo-fixtureset aan elke
// bundel. Daarom staat het hier apart; demoFixtures exporteert het door
// zodat bestaande imports blijven werken.

export function isDemoPath(pathname: string | null | undefined): boolean {
  return !!pathname && pathname.startsWith('/demo')
}

/** Huidige route is /demo. Ook bruikbaar buiten React-componenten, die
 *  geen usePathname() hebben. Let op: dit leest window.location, dus roep
 *  het niet aan tijdens het renderen — op de server is het altijd false en
 *  dan klopt de eerste client-render niet met de server-HTML. In effecten,
 *  handlers en store-functies is het prima. */
export function isOnDemoRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')
}

/** Sleutel voor localStorage, met een demo-variant die nooit bij echte
 *  data kan komen. 'yoko-budget-entries' → 'yoko-demo-budget-entries'. */
export function scopedKey(key: string): string {
  if (!isOnDemoRoute()) return key
  return key.startsWith('yoko-') ? `yoko-demo-${key.slice(5)}` : `demo-${key}`
}
