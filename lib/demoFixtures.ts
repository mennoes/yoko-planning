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
// 8 leden i.p.v. de oorspronkelijke 4 — een grotere, drukkere cast maakt
// Planning/Werklast/Home er meteen representatiever uitzien (verdeelde
// capaciteit, overlappende deadlines, een inactief lid als voorbeeld van
// die sectie) i.p.v. een leeg-ogende demo met maar een handjevol namen.
export const DEMO_MEMBERS: TeamMember[] = [
  { id: 'demo-sam',   name: 'Sam',   email: '', color: '#B0C6EB', weeklyCapacity: 40, position: 0, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-robin', name: 'Robin', email: '', color: '#9DB1A4', weeklyCapacity: 32, position: 1, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-jules', name: 'Jules', email: '', color: '#C09BCA', weeklyCapacity: 40, position: 2, hidden: false, kind: 'freelance',  startDate: null, inactive: false },
  { id: 'demo-noa',   name: 'Noa',   email: '', color: '#D8B62E', weeklyCapacity: 24, position: 3, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-finn',  name: 'Finn',  email: '', color: '#7FB3D5', weeklyCapacity: 40, position: 4, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-mila',  name: 'Mila',  email: '', color: '#E8998D', weeklyCapacity: 24, position: 5, hidden: false, kind: 'freelance',  startDate: null, inactive: false },
  { id: 'demo-liam',  name: 'Liam',  email: '', color: '#A3D9A5', weeklyCapacity: 16, position: 6, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-eva',   name: 'Eva',   email: '', color: '#D7BDE2', weeklyCapacity: 24, position: 7, hidden: false, kind: 'freelance',  startDate: null, inactive: true  },
  { id: 'demo-tess',  name: 'Tess',  email: '', color: '#F4A896', weeklyCapacity: 40, position: 8, hidden: false, kind: 'yoko',       startDate: null, inactive: false },
  { id: 'demo-bram',  name: 'Bram',  email: '', color: '#93B5C6', weeklyCapacity: 32, position: 9, hidden: false, kind: 'freelance',  startDate: null, inactive: false },
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
  'demo-finn':  'https://randomuser.me/api/portraits/men/12.jpg',
  'demo-mila':  'https://randomuser.me/api/portraits/women/68.jpg',
  'demo-liam':  'https://randomuser.me/api/portraits/men/76.jpg',
  'demo-eva':   'https://randomuser.me/api/portraits/women/50.jpg',
  'demo-tess':  'https://randomuser.me/api/portraits/women/31.jpg',
  'demo-bram':  'https://randomuser.me/api/portraits/men/45.jpg',
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
//
// LET OP bij uitbreiden: app/demo/budget/page.tsx verwijst naar specifieke
// item-id's (bv. 'Noorderlicht Media__i4') voor z'n omzet-fixtures — nieuwe
// items krijgen dus altijd een NIEUW id-suffix (i8, i9, ...), bestaande
// id's nooit hernummeren/verwijderen. Een derde bord toevoegen vereist ook
// een bijpassend entry in lib/navStore.ts's DEMO_PROJECTS en
// lib/boardsRegistry.ts's DEMO_FALLBACK (allebei niet automatisch afgeleid
// van deze lijst).
export const DEMO_BOARD_IDS = ['Noorderlicht Media', 'Kaap Studio', 'Vuurtoren Events']

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
            item('i8', 'Nieuwsbrief — juli editie', ['demo-finn'], 'Working on...', { startOffset: -1, endOffset: 2, estHours: 6, deadlineOffset: 2 }),
            item('i9', 'Podcast — gastenlijst Q3', ['demo-mila', 'demo-noa'], 'Not started', { startOffset: 6, endOffset: 9, estHours: 8 }),
            item('i10', 'Merkfilm — kleurcorrectie', ['demo-liam'], 'Stuck', { startOffset: -2, endOffset: 2, estHours: 14, deadlineOffset: 3 }),
            item('i11', 'Fotoshoot — bedrijfsportretten', ['demo-finn', 'demo-jules'], 'Not started', {
              deadlineOffset: 30,
              subitems: [
                sub('s1', 'Locatiescout', ['demo-finn'], 'Working on...', 8, 10, 6),
                sub('s2', 'Shootdag', ['demo-finn', 'demo-jules'], 'Not started', 15, 15, 10),
                sub('s3', 'Selectie + retouche', ['demo-jules'], 'Not started', 16, 22, 12),
              ],
            }),
            item('i12', 'Jaaroverzicht — scriptidee pitchen', ['demo-sam', 'demo-robin'], 'Not started', { startOffset: 20, endOffset: 22, estHours: 4, deadlineOffset: 23 }),
            item('i15', 'Documentaire — onderzoeksfase', ['demo-tess'], 'Working on...', { startOffset: -3, endOffset: 5, estHours: 22, deadlineOffset: 8 }),
            item('i16', 'Documentaire — interviewplanning', ['demo-tess', 'demo-bram'], 'Not started', {
              deadlineOffset: 16,
              subitems: [
                sub('s1', 'Kandidaten benaderen', ['demo-tess'], 'Working on...', 2, 5, 6),
                sub('s2', 'Interviews inplannen', ['demo-bram'], 'Not started', 6, 9, 4),
              ],
            }),
            item('i17', 'Merkfilm — geluidsmix', ['demo-bram'], 'Not started', { startOffset: 4, endOffset: 6, estHours: 10, deadlineOffset: 7 }),
            item('i18', 'Nieuwsbrief — augustus editie', ['demo-finn'], 'Not started', { startOffset: 12, endOffset: 14, estHours: 6, deadlineOffset: 15 }),
            item('i19', 'Social cutdowns — review klant', ['demo-noa', 'demo-tess'], 'Not started', { startOffset: 19, endOffset: 19, estHours: 3, deadlineOffset: 20 }),
            item('i20', 'Archiefbeelden — digitaliseren', ['demo-bram'], 'Working on...', { startOffset: -1, endOffset: 4, estHours: 12 }),
          ],
        },
        {
          id: 'g2', name: 'Done', color: '#9A9590', items: [
            item('i5', 'Intake + offerte', ['demo-sam'], 'Done', { startOffset: -20, endOffset: -16, estHours: 6 }),
            item('i13', 'Vorig kwartaal — eindrapportage', ['demo-robin'], 'Done', { startOffset: -30, endOffset: -27, estHours: 8 }),
            item('i14', 'Merkfilm — pitch + akkoord klant', ['demo-sam'], 'Done', { startOffset: -35, endOffset: -33, estHours: 5 }),
            item('i21', 'Documentaire — intake + treatment', ['demo-tess'], 'Done', { startOffset: -10, endOffset: -8, estHours: 9 }),
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
            item('i6', 'Verpakkingsontwerp — schetsen', ['demo-mila'], 'Working on...', { startOffset: -2, endOffset: 3, estHours: 16, deadlineOffset: 6 }),
            item('i7', 'Social templates — Q3 batch', ['demo-eva'], 'Not started', { startOffset: 10, endOffset: 13, estHours: 9 }),
            item('i8', 'Klant-workshop voorbereiden', ['demo-sam', 'demo-finn'], 'Working on...', { startOffset: 0, endOffset: 2, estHours: 6, deadlineOffset: 3 }),
            item('i9', 'Merchandise — sampledrop bestellen', ['demo-jules'], 'Stuck', { startOffset: -4, endOffset: -1, estHours: 4 }),
            item('i10', 'Podcast S2 — seizoensfinale', ['demo-noa', 'demo-mila'], 'Not started', {
              deadlineOffset: 35,
              subitems: [
                sub('s1', 'Script + gasten', ['demo-noa'], 'Not started', 22, 26, 10),
                sub('s2', 'Opname', ['demo-noa', 'demo-mila'], 'Not started', 28, 28, 6),
                sub('s3', 'Edit + mix', ['demo-mila'], 'Not started', 29, 33, 14),
              ],
            }),
            item('i13', 'Verpakkingsontwerp — proefdruk', ['demo-mila', 'demo-bram'], 'Not started', { startOffset: 6, endOffset: 9, estHours: 10, deadlineOffset: 10 }),
            item('i14', 'Website — content aanleveren', ['demo-tess'], 'Working on...', { startOffset: -1, endOffset: 3, estHours: 8, deadlineOffset: 5 }),
            item('i15', 'Merchandise — webshop koppeling', ['demo-bram'], 'Not started', { startOffset: 8, endOffset: 12, estHours: 14, deadlineOffset: 13 }),
            item('i16', 'Klantpresentatie — Q4 voorstel', ['demo-sam', 'demo-tess'], 'Not started', { startOffset: 16, endOffset: 17, estHours: 6, deadlineOffset: 18 }),
            item('i17', 'Podcast — coverart nieuw seizoen', ['demo-eva'], 'Working on...', { startOffset: 0, endOffset: 2, estHours: 8, deadlineOffset: 3 }),
            item('i18', 'Huisstijl — social media kit', ['demo-jules', 'demo-eva'], 'Not started', {
              deadlineOffset: 22,
              subitems: [
                sub('s1', 'Templates ontwerpen', ['demo-jules'], 'Not started', 12, 16, 12),
                sub('s2', 'Export + documentatie', ['demo-eva'], 'Not started', 17, 19, 6),
              ],
            }),
          ],
        },
        {
          id: 'g2', name: 'Done', color: '#9A9590', items: [
            item('i11', 'Huisstijl — intake + moodboard-akkoord', ['demo-jules'], 'Done', { startOffset: -14, endOffset: -12, estHours: 5 }),
            item('i12', 'Podcast S2 — aflevering 1 + 2', ['demo-noa'], 'Done', { startOffset: -18, endOffset: -8, estHours: 22 }),
            item('i19', 'Merchandise — leverancier geselecteerd', ['demo-bram'], 'Done', { startOffset: -12, endOffset: -10, estHours: 4 }),
          ],
        },
      ],
    },
    'Vuurtoren Events': {
      groups: [
        {
          id: 'g1', name: 'Lopende projecten', color: '#5FA8A0', items: [
            item('i1', 'Festivalweekend — draaiboek', ['demo-eva', 'demo-finn'], 'Working on...', { startOffset: -2, endOffset: 4, estHours: 18, deadlineOffset: 5 }),
            item('i2', 'Aftermovie — vorig jaar recap', ['demo-liam'], 'Not started', { startOffset: 7, endOffset: 12, estHours: 20, deadlineOffset: 14 }),
            item('i3', 'Sponsorpakket — pitchdeck', ['demo-robin', 'demo-eva'], 'Working on...', { startOffset: -1, endOffset: 3, estHours: 10, deadlineOffset: 4 }),
            item('i4', 'Line-up aankondiging — social plan', ['demo-mila'], 'Not started', { startOffset: 9, endOffset: 11, estHours: 8, deadlineOffset: 12 }),
            item('i5', 'Ticketpagina — copy + design', ['demo-jules', 'demo-finn'], 'Not started', {
              deadlineOffset: 20,
              subitems: [
                sub('s1', 'Copy schrijven', ['demo-eva'], 'Not started', 10, 12, 6),
                sub('s2', 'Design + bouw', ['demo-jules', 'demo-finn'], 'Not started', 13, 18, 16),
              ],
            }),
            item('i6', 'Vrijwilligersbriefing plannen', ['demo-liam'], 'Not started', { startOffset: 25, endOffset: 25, estHours: 3 }),
            // Bewust boven Liams weekcapaciteit (16u) gepland deze week —
            // zodat de 'Overbelast deze week'-widget op Home ook echt een
            // voorbeeld toont i.p.v. altijd de lege 'iedereen onder cap'-staat.
            item('i9', 'Spoedklus — geluidscheck techniek', ['demo-liam'], 'Working on...', { startOffset: 0, endOffset: 2, estHours: 20, deadlineOffset: 3 }),
            item('i10', 'Foodtrucks — contracten rondmaken', ['demo-tess'], 'Working on...', { startOffset: -1, endOffset: 3, estHours: 8, deadlineOffset: 4 }),
            item('i11', 'Programmering — tweede stage boeken', ['demo-bram', 'demo-eva'], 'Not started', {
              deadlineOffset: 18,
              subitems: [
                sub('s1', 'Longlist artiesten', ['demo-bram'], 'Not started', 8, 10, 6),
                sub('s2', 'Boekingen afronden', ['demo-eva'], 'Not started', 11, 15, 10),
              ],
            }),
            item('i12', 'Veiligheidsplan — update indienen', ['demo-sam'], 'Not started', { startOffset: 15, endOffset: 16, estHours: 6, deadlineOffset: 17 }),
            item('i13', 'Merchandise-kraam — voorraad bestellen', ['demo-tess'], 'Not started', { startOffset: 13, endOffset: 13, estHours: 3 }),
            item('i14', 'Vrijwilligers — wervingspost social', ['demo-mila'], 'Working on...', { startOffset: -2, endOffset: 1, estHours: 5, deadlineOffset: 2 }),
          ],
        },
        {
          id: 'g2', name: 'Done', color: '#9A9590', items: [
            item('i7', 'Locatie — contract getekend', ['demo-sam'], 'Done', { startOffset: -25, endOffset: -23, estHours: 4 }),
            item('i8', 'Vorig jaar — evaluatie + leerpunten', ['demo-robin', 'demo-eva'], 'Done', { startOffset: -22, endOffset: -20, estHours: 6 }),
            item('i15', 'Vergunningaanvraag — ingediend', ['demo-sam'], 'Done', { startOffset: -18, endOffset: -16, estHours: 5 }),
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
  { id: 'dt4', text: 'Sponsorpakket — voorbeelden opsturen naar Daan', done: false },
  { id: 'dt5', text: 'Locatiescout-foto\'s doorsturen naar Jules', done: false },
  { id: 'dt6', text: 'Podcast-gastenlijst afstemmen met Mila', done: true },
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
  // Vaste id's ('tools'/'samenwerkingen'/'vakantie'/'loonstroken') — de
  // 'Pagina's'-widget op Home linkt hier met een hardcoded /pages/<id>,
  // dus deze moeten exact zo heten, niet 'demo-'-geprefixt zoals de rest.
  {
    id: 'tools', title: 'Tools', emoji: '🎨',
    content: 'Software die we gebruiken: Adobe Creative Cloud, Figma, Notion, Slack, Google Workspace. Nieuwe licentie nodig? Vraag aan via Accounts.',
    createdAt: '2026-04-01T09:00:00.000Z', updatedAt: '2026-04-01T09:00:00.000Z', folderId: null,
  },
  {
    id: 'samenwerkingen', title: 'Samenwerkingen', emoji: '❤️',
    content: 'Vaste freelancers en partners waar we regelmatig mee samenwerken, met specialisme en contactpersoon.',
    createdAt: '2026-03-15T09:00:00.000Z', updatedAt: '2026-03-15T09:00:00.000Z', folderId: null,
  },
  {
    id: 'vakantie', title: 'Vakantieaanvragen', emoji: '🏝',
    content: 'Hoe je vrije dagen aanvraagt: minimaal 2 weken van tevoren via de knop "Vakantie aanvragen" op Home, akkoord van je lead, dan verschijnt \'ie in de planning.',
    createdAt: '2026-02-10T09:00:00.000Z', updatedAt: '2026-02-10T09:00:00.000Z', folderId: null,
  },
  {
    id: 'loonstroken', title: 'Loonstroken', emoji: '💰',
    content: 'Loonstroken staan uiterlijk de 25e van de maand klaar. Vragen over je strook? Stuur een berichtje naar de administratie.',
    createdAt: '2026-01-20T09:00:00.000Z', updatedAt: '2026-01-20T09:00:00.000Z', folderId: null,
  },
]
