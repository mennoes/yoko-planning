// Verzonnen fixtures voor de publieke /demo-omgeving. Wordt gebruikt door
// de demo-varianten van Home/Planning/Todo's (app/demo/**) EN door
// ProfileContext/TeamContext om een demo-bezoeker een consistente, nep
// identiteit + team + boards te geven zonder ooit Supabase te raken.
//
// BELANGRIJK: dit bestand mag NOOIT echte klant- of teamnamen bevatten —
// alles hier is fictief en puur bedoeld om de tool te laten zien (bv. op
// LinkedIn) zonder echte Studio Yoko-data bloot te geven.
import type { BoardGroup, BoardItem, SubItem } from './boards'
import type { TeamMember } from './teamStore'
import type { UserProfile } from './profile'

export function isDemoPath(pathname: string | null | undefined): boolean {
  return !!pathname && pathname.startsWith('/demo')
}

// Huidige route is /demo, ook bruikbaar buiten React-componenten (plain
// lib-modules hebben geen usePathname()).
export function isOnDemoRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')
}

export const DEMO_BLOCKED_EVENT = 'yoko-demo-blocked'

// Toont de 'dit kan niet in de demo'-toast — gebruikt door elke actie die
// een echt account/echte backend nodig heeft (Google-koppeling, admin-
// pagina's, etc.) en dus nooit zinnig te faken is. De listener zit in
// components/DemoShell.tsx.
export function notifyDemoBlocked(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DEMO_BLOCKED_EVENT))
}

// Bekende 1-op-1 demo-equivalenten van echte routes — navigatie hierheen
// werkt gewoon, alleen omgeleid naar de /demo-tak. Alles daarbuiten heeft
// geen zinnig demo-equivalent (team-beheer, accounts, budget, losse
// bord-tabel, ...) en toont in plaats daarvan de 'kan niet in de demo'-
// toast (zie notifyDemoBlocked).
const DEMO_EQUIVALENTS: Record<string, string> = {
  '/':         '/demo',
  '/planning': '/demo/planning',
  '/todos':    '/demo/todos',
}

/** Vertaalt een 'echte' href naar de demo-variant. Externe links (mailto:,
 *  tel:, http(s):, of een relatief pad zonder leidende '/') komen ONGEWIJZIGD
 *  terug — die zijn altijd veilig. Voor interne app-paden zonder zinnig
 *  demo-equivalent geeft 'ie null terug (dan toont de aanroeper
 *  notifyDemoBlocked i.p.v. te navigeren). */
export function demoSafeHref(href: string): string | null {
  if (!href.startsWith('/')) return href // mailto:/tel:/http(s):/relatief: nooit blokkeren
  if (href.startsWith('/demo')) return href
  const [base, query] = href.split('?')
  if (DEMO_EQUIVALENTS[base]) return DEMO_EQUIVALENTS[base] + (query ? `?${query}` : '')
  if (base.startsWith('/projects/')) return '/demo/planning'
  return null
}

/** Voor router.push()-aanroepen (geen <a>-klik) — navigeert naar het
 *  demo-equivalent, of toont de 'kan niet'-toast als dat er niet is. */
export function demoNavigate(router: { push: (href: string) => void }, href: string): void {
  const safe = demoSafeHref(href)
  if (safe) router.push(safe)
  else notifyDemoBlocked()
}

// ─── Team ───────────────────────────────────────────────────────────────────
export const DEMO_MEMBERS: TeamMember[] = [
  { id: 'demo-sam',   name: 'Sam',   email: '', color: '#B0C6EB', weeklyCapacity: 40, position: 0, hidden: false, kind: 'yoko',        startDate: null, inactive: false },
  { id: 'demo-robin', name: 'Robin', email: '', color: '#9DB1A4', weeklyCapacity: 32, position: 1, hidden: false, kind: 'yoko',        startDate: null, inactive: false },
  { id: 'demo-jules', name: 'Jules', email: '', color: '#C09BCA', weeklyCapacity: 40, position: 2, hidden: false, kind: 'freelance',  startDate: null, inactive: false },
  { id: 'demo-noa',   name: 'Noa',   email: '', color: '#D8B62E', weeklyCapacity: 24, position: 3, hidden: false, kind: 'yoko',        startDate: null, inactive: false },
]

export const DEMO_PROFILE: UserProfile = {
  memberId: 'demo-sam', name: 'Sam', color: '#B0C6EB', photo: null,
}

// ─── Willekeurige 'gezichten' voor de nep-teamleden ────────────────────────
// Simpele, eigen (geen externe dienst) SVG-avatars i.p.v. platte letter-
// cirkels — elk teamlid krijgt een net iets andere vorm/uitdrukking.
function faceSvg(bg: string, variant: number): string {
  const faces = [
    // ronde ogen, brede glimlach
    '<circle cx="34" cy="42" r="5" fill="#1a1714"/><circle cx="66" cy="42" r="5" fill="#1a1714"/><path d="M32 60 Q50 76 68 60" stroke="#1a1714" stroke-width="5" fill="none" stroke-linecap="round"/>',
    // ovale ogen, kleine glimlach + wenkbrauwen
    '<ellipse cx="34" cy="42" rx="4" ry="6" fill="#1a1714"/><ellipse cx="66" cy="42" rx="4" ry="6" fill="#1a1714"/><path d="M26 32 Q34 27 42 32M58 32 Q66 27 74 32" stroke="#1a1714" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M38 62 Q50 70 62 62" stroke="#1a1714" stroke-width="5" fill="none" stroke-linecap="round"/>',
    // knipoog, brede grijns
    '<circle cx="34" cy="42" r="5" fill="#1a1714"/><path d="M60 42 Q66 38 72 42" stroke="#1a1714" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M30 58 Q50 78 70 58" stroke="#1a1714" stroke-width="5" fill="none" stroke-linecap="round"/>',
    // vierkante bril, rechte mond
    '<rect x="24" y="34" width="20" height="16" rx="6" fill="none" stroke="#1a1714" stroke-width="3.5"/><rect x="56" y="34" width="20" height="16" rx="6" fill="none" stroke="#1a1714" stroke-width="3.5"/><line x1="44" y1="42" x2="56" y2="42" stroke="#1a1714" stroke-width="3.5"/><line x1="38" y1="64" x2="62" y2="64" stroke="#1a1714" stroke-width="5" stroke-linecap="round"/>',
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${bg}"/>
    ${faces[variant % faces.length]}
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const DEMO_PHOTOS: Record<string, string> = {
  'demo-sam':   faceSvg('#B0C6EB', 0),
  'demo-robin': faceSvg('#9DB1A4', 1),
  'demo-jules': faceSvg('#C09BCA', 2),
  'demo-noa':   faceSvg('#D8B62E', 3),
}

// ─── Boards ─────────────────────────────────────────────────────────────────
// Dagen-offset t.o.v. 'vandaag' op het moment dat de demo voor het eerst in
// een browser wordt gezaaid (loadGroups cachet daarna in localStorage,
// exact zoals bij een echt bord — verse bezoekers krijgen altijd een
// actueel ogende demo, bestaande bezoekers behouden hun eigen wijzigingen).
function iso(offsetDays: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function sub(id: string, name: string, ownerIds: string[], status: string, startOffset: number, endOffset: number, estHours: number): SubItem {
  return { id, name, ownerIds, status, startDate: iso(startOffset), endDate: iso(endOffset), estHours }
}

function item(id: string, name: string, ownerIds: string[], status: string, opts: { startOffset?: number; endOffset?: number; estHours?: number; subitems?: SubItem[] } = {}): BoardItem {
  const { startOffset, endOffset, estHours, subitems } = opts
  return {
    id, name, ownerIds, status,
    startDate: startOffset != null ? iso(startOffset) : null,
    endDate:   endOffset   != null ? iso(endOffset)   : (startOffset != null ? iso(startOffset) : null),
    deadline: null, estHours: estHours ?? 0, dagen: 0,
    subitems,
  }
}

// Board-'id' is bewust de leesbare naam zelf (i.p.v. een slug) — overal
// waar de app een onbekend board-id niet kan opzoeken in de (Supabase-
// backed) boardsRegistry valt 'ie terug op het rauwe id als label. Door
// het id zelf al leesbaar te maken ('Noorderlicht Media') i.p.v. een
// technische slug ('demo-noorderlicht'), oogt die fallback gewoon goed.
export const DEMO_BOARD_IDS = ['Noorderlicht Media', 'Kaap Studio']

export function buildDemoBoards(): Record<string, { groups: BoardGroup[] }> {
  return {
    'Noorderlicht Media': {
      groups: [
        {
          id: 'g1', name: 'Lopende projecten', color: '#B0C6EB', items: [
            item('i1', 'Merkfilm — script + storyboard', ['demo-sam'], 'Done', { startOffset: -9, endOffset: -3, estHours: 24 }),
            item('i2', 'Merkfilm — edit', ['demo-robin'], 'Working on...', {
              subitems: [
                sub('s1', 'Edit v1', ['demo-robin'], 'Working on...', 0, 6, 32),
                sub('s2', 'Edit v2 — klantfeedback', ['demo-robin'], 'Not started', 9, 12, 12),
              ],
            }),
            item('i3', 'Social cutdowns (5x)', ['demo-noa'], 'Not started', { startOffset: 14, endOffset: 18, estHours: 14 }),
            item('i4', 'Kickoff volgend seizoen', ['demo-sam', 'demo-jules'], 'Not started', { startOffset: 3, endOffset: 3, estHours: 2 }),
          ],
        },
        {
          id: 'g2', name: 'Done', color: '#9A9590', items: [
            item('i5', 'Intake + offerte', ['demo-sam'], 'Done', { startOffset: -20, endOffset: -16, estHours: 6 }),
          ],
        },
      ],
    },
    'Kaap Studio': {
      groups: [
        {
          id: 'g1', name: 'Lopende projecten', color: '#D8935B', items: [
            item('i1', 'Huisstijl — moodboard', ['demo-jules'], 'Done', { startOffset: -6, endOffset: -4, estHours: 10 }),
            item('i2', 'Huisstijl — logo-varianten', ['demo-jules'], 'Working on...', { startOffset: -1, endOffset: 4, estHours: 20 }),
            item('i3', 'Website', ['demo-sam', 'demo-jules'], 'Not started', {
              subitems: [
                sub('s1', 'Wireframes', ['demo-sam', 'demo-jules'], 'Not started', 5, 11, 28),
                sub('s2', 'Launch prep', ['demo-sam'], 'Not started', 18, 24, 16),
              ],
            }),
            item('i4', 'Podcast S2 — aflevering 3 edit', ['demo-noa'], 'Working on...', { startOffset: -3, endOffset: 1, estHours: 12 }),
            item('i5', 'Trailer volgend seizoen', ['demo-robin'], 'Not started', { startOffset: 14, endOffset: 20, estHours: 18 }),
          ],
        },
      ],
    },
  }
}

export const DEMO_TODOS = [
  { id: 'dt1', text: 'Facturen vorige maand versturen', done: false },
  { id: 'dt2', text: 'Intake nieuwe klant voorbereiden', done: false },
  { id: 'dt3', text: 'Feedback merkfilm-edit doorsturen', done: true },
]
