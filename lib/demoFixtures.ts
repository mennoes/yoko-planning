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
  '/':            '/demo',
  '/planning':    '/demo/planning',
  '/todos':       '/demo/todos',
  '/team':        '/demo/team',
  '/team-admin':  '/demo/team-admin',
  '/kantoor':     '/demo/kantoor',
  '/budget':      '/demo/budget',
  '/accounts':    '/demo/accounts',
  '/geschiedenis': '/demo/geschiedenis',
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
  if (base.startsWith('/projects/')) return '/demo' + base
  if (base.startsWith('/pages/')) return '/demo' + base
  if (base.startsWith('/profile/')) return '/demo' + base
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

// ─── 'Gezichten' voor de nep-teamleden ──────────────────────────────────────
// Echte (gestockte model-)portretfoto's i.p.v. lettertje-cirkels — random-
// user.me is precies hiervoor bedoeld (stabiele, vaste URL's per index,
// puur illustratief, nooit een echt persoon die aan onze data hangt).
export const DEMO_PHOTOS: Record<string, string> = {
  'demo-sam':   'https://randomuser.me/api/portraits/men/32.jpg',
  'demo-robin': 'https://randomuser.me/api/portraits/women/44.jpg',
  'demo-jules': 'https://randomuser.me/api/portraits/men/67.jpg',
  'demo-noa':   'https://randomuser.me/api/portraits/women/23.jpg',
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

function item(id: string, name: string, ownerIds: string[], status: string, opts: { startOffset?: number; endOffset?: number; estHours?: number; subitems?: SubItem[]; deadlineOffset?: number } = {}): BoardItem {
  const { startOffset, endOffset, estHours, subitems, deadlineOffset } = opts
  return {
    id, name, ownerIds, status,
    startDate: startOffset != null ? iso(startOffset) : null,
    endDate:   endOffset   != null ? iso(endOffset)   : (startOffset != null ? iso(startOffset) : null),
    deadline: deadlineOffset != null ? iso(deadlineOffset) : null,
    estHours: estHours ?? 0, dagen: 0,
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
              deadlineOffset: 5,
              subitems: [
                sub('s1', 'Edit v1', ['demo-robin'], 'Working on...', 0, 6, 32),
                sub('s2', 'Edit v2 — klantfeedback', ['demo-robin'], 'Not started', 9, 12, 12),
              ],
            }),
            item('i3', 'Social cutdowns (5x)', ['demo-noa'], 'Not started', { startOffset: 14, endOffset: 18, estHours: 14, deadlineOffset: 19 }),
            item('i4', 'Kickoff volgend seizoen', ['demo-sam', 'demo-jules'], 'Not started', { startOffset: 3, endOffset: 3, estHours: 2 }),
            item('i6', 'Merkfilm — klant-call + debrief', ['demo-sam'], 'Working on...', { startOffset: 0, endOffset: 1, estHours: 8, deadlineOffset: 2 }),
            item('i7', 'Merkfilm — voice-over regelen', ['demo-sam'], 'Not started', { startOffset: 1, endOffset: 3, estHours: 10 }),
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
            item('i2', 'Huisstijl — logo-varianten', ['demo-jules'], 'Working on...', { startOffset: -1, endOffset: 4, estHours: 20, deadlineOffset: 4 }),
            item('i3', 'Website', ['demo-sam', 'demo-jules'], 'Not started', {
              deadlineOffset: 25,
              subitems: [
                sub('s1', 'Wireframes', ['demo-sam', 'demo-jules'], 'Not started', 5, 11, 28),
                sub('s2', 'Launch prep', ['demo-sam'], 'Not started', 18, 24, 16),
              ],
            }),
            item('i4', 'Podcast S2 — aflevering 3 edit', ['demo-noa'], 'Working on...', { startOffset: -3, endOffset: 1, estHours: 12, deadlineOffset: 1 }),
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

// ─── Documenten (Pagina's) ──────────────────────────────────────────────────
// Zelfde shape als lib/pagesStore.ts' DocFolder/PageDoc — hier los
// gedefinieerd i.p.v. geïmporteerd zodat dit fixture-bestand geen
// afhankelijkheid naar pagesStore hoeft te hebben.
export type DemoDocFolder = { id: string; name: string; emoji?: string }
export type DemoPageDoc = {
  id: string; title: string; content: string; emoji: string
  createdAt: string; updatedAt: string; folderId?: string | null
}

export const DEMO_DOC_FOLDERS: DemoDocFolder[] = [
  { id: 'demo-df1', name: 'Klantcontracten' },
]

export const DEMO_PAGES: DemoPageDoc[] = [
  {
    id: 'demo-dp1', title: 'Huisstijl-richtlijnen', emoji: '🎨',
    content: 'Kleuren, typografie en logo-gebruik voor Noorderlicht Media — zie het gedeelde brandbook voor de volledige set.',
    createdAt: '2026-06-02T09:00:00.000Z', updatedAt: '2026-06-02T09:00:00.000Z', folderId: null,
  },
  {
    id: 'demo-dp2', title: 'Onboarding nieuwe klant', emoji: '📋',
    content: 'Checklist voor een nieuwe klant: intake-gesprek, offerte, kickoff plannen, toegang tot gedeelde mappen regelen.',
    createdAt: '2026-05-14T09:00:00.000Z', updatedAt: '2026-05-14T09:00:00.000Z', folderId: 'demo-df1',
  },
]
