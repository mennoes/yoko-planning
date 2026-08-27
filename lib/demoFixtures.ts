// Verzonnen fixtures voor de publieke /demo-omgeving. Wordt gebruikt door
// de demo-varianten van Home/Planning/Todo's (app/demo/**) EN door
// ProfileContext/TeamContext om een demo-bezoeker een consistente, nep
// identiteit + team + boards te geven zonder ooit Supabase te raken.
//
// BELANGRIJK: dit bestand mag NOOIT echte klant- of teamnamen bevatten —
// alles hier is fictief en puur bedoeld om de tool te laten zien (bv. op
// LinkedIn) zonder echte Studio Yoko-data bloot te geven.
import type { BoardGroup, BoardItem } from './boards'
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
  '/activity':    '/demo/activity',
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
// De publieke demo mag best laten zien dat plannen ook leuk kan zijn.
// De tien fictieve collega's komen uit kinder-tv, Pokemon en jeugdboeken;
// de stabiele ids blijven gelijk zodat alle demo-features blijven werken.
export const DEMO_MEMBERS: TeamMember[] = [
  { id: 'demo-sam',   name: 'Bert',        email: '', color: '#F2C94C', weeklyCapacity: 40, position: 0, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-robin', name: 'Pikachu',     email: '', color: '#FFD93D', weeklyCapacity: 32, position: 1, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-jules', name: 'Pippi',       email: '', color: '#F299C2', weeklyCapacity: 40, position: 2, hidden: false, kind: 'freelance', startDate: null, inactive: false },
  { id: 'demo-noa',   name: 'Rembo',       email: '', color: '#9B51E0', weeklyCapacity: 24, position: 3, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-finn',  name: 'Moffel',      email: '', color: '#6FCF97', weeklyCapacity: 40, position: 4, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-mila',  name: 'Piertje',     email: '', color: '#EB5757', weeklyCapacity: 24, position: 5, hidden: false, kind: 'freelance', startDate: null, inactive: false },
  { id: 'demo-liam',  name: 'Tinky Winky', email: '', color: '#8C6ADE', weeklyCapacity: 16, position: 6, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-eva',   name: 'Pipo',        email: '', color: '#F2994A', weeklyCapacity: 24, position: 7, hidden: false, kind: 'freelance', startDate: null, inactive: false },
  { id: 'demo-tess',  name: 'Bassie',      email: '', color: '#2D9CDB', weeklyCapacity: 40, position: 8, hidden: false, kind: 'yoko',      startDate: null, inactive: false },
  { id: 'demo-bram',  name: 'Adriaan',     email: '', color: '#27AE60', weeklyCapacity: 32, position: 9, hidden: false, kind: 'freelance', startDate: null, inactive: false },
]

export const DEMO_PROFILE: UserProfile = {
  memberId: 'demo-sam', name: 'Bert', color: '#F2C94C', photo: null,
}

// ─── 'Gezichten' voor de nep-teamleden ──────────────────────────────────────
export const DEMO_PHOTOS: Record<string, string> = {
  'demo-sam':   'https://www.pinclipart.com/picdir/middle/572-5726831_bert-sesame-street-characters-clipart.png',
  'demo-robin': 'https://assets.pokemon.com/assets/cms2/img/pokedex/full/025.png',
  'demo-jules': 'https://cdn01.nyheter24.se/b3a2c1ea03d802d802/2017/05/04/1398612/pippi-langstrump.jpg',
  'demo-noa':   'https://media.1815.io/jfk/i/full/2019/06/rembo-en-rembo-online-kijken.jpg',
  'demo-finn':  'https://api3.schooltv.nl/cache/i/26000/images/26608.w402.r1-1.ee1f37c.q90.webp',
  'demo-mila':  'https://img.youtube.com/vi/0iT87zXzzLM/maxresdefault.jpg',
  'demo-liam':  'https://i.pinimg.com/474x/d9/23/da/d923da86c7fd3f8c7fd57344715aaccc.jpg',
  'demo-eva':   'https://upload.wikimedia.org/wikipedia/commons/b/b5/Pipo_de_Clown.png',
  'demo-tess':  'https://image.demorgen.be/36198022/width/640/bas-van-toor',
  'demo-bram':  'https://redactie.rtl.nl/sites/default/files/content/images/2019/11/05/Aad.jpg?height=768&impolicy=semi_dynamic&itok=nzCRnGvp&width=1024',
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

function item(id: string, name: string, ownerIds: string[], status: string, opts: { startOffset?: number; endOffset?: number; estHours?: number; deadlineOffset?: number } = {}): BoardItem {
  const { startOffset, endOffset, estHours, deadlineOffset } = opts
  return {
    id, name, ownerIds, status,
    startDate: startOffset != null ? iso(startOffset) : null,
    endDate:   endOffset   != null ? iso(endOffset)   : (startOffset != null ? iso(startOffset) : null),
    deadline: deadlineOffset != null ? iso(deadlineOffset) : null,
    estHours: estHours ?? 0, dagen: 0,
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
export const DEMO_BOARD_IDS = ['De Gouw & Bree', 'Rivendel & Rohan', 'Gondor & Mordor']

// Exact honderd aanvragen voor planningstools van bedrijven die uitstekend
// in Midden-aarde hadden kunnen bestaan. De titels zijn luchtig; de data
// erachter blijft realistisch genoeg om planning, capaciteit en deadlines
// goed te demonstreren.
const DEMO_REQUESTS = [
  "De Steigerende Pony — kamers, tafels en biervaten plannen",
  "Gouwse Tweede Ontbijtservice — bezorgroutes automatiseren",
  "Baggins Bagage — expedities en koffers verdelen",
  "Sam Gewis Tuinonderhoud — hobbit-hoveniers inroosteren",
  "Took & Co Vuurwerk — shows, vergunningen en lonten plannen",
  "Brandebok Postduiven — vluchten en brieven verdelen",
  "Boer van der Made Champignons — oogstploegen inplannen",
  "Groene Draak Brouwerij — ketels en proeverijen reserveren",
  "Balingshoek Veerdienst — overtochten en ponydiensten plannen",
  "Feestboom Festivals — podia en tweede ontbijten verdelen",
  "Balingshoek Gatenbouw — aannemers per hobbitgat plannen",
  "Bilbo Uitgeverij — hoofdstukken, dwergen en deadlines bewaken",
  "Het Rode Boek — honderd jaar correctierondes plannen",
  "Gouwse Sheriffdienst — avondpatrouilles inroosteren",
  "Westgouw Vuurwerkbezorging — raketten op tijd leveren",
  "Merry & Pippin Catering — zes maaltijden per dag plannen",
  "Rosie Katoen Bruiloften — feesttenten en boeketten verdelen",
  "Frodo Verhuisservice — breekbare ringen apart plannen",
  "Zak Einde B&B — kamers zonder onverwachte tovenaars boeken",
  "Michel Delving Archief — leeszalen en perkament reserveren",
  "Rivendel Raadzaal — eeuwenlange vergaderingen korter plannen",
  "Elrond Events — geheime raden en lunchpauzes combineren",
  "Legolas Pijlenservice — voorraad en schietbanen plannen",
  "Gimli Mijnbeheer — dwergen over schachten verdelen",
  "Khazad-dûm Delvers — ploegendienst zonder Balrogconflict",
  "Lothlórien Boomhotels — kamers per boomtop boeken",
  "Galadriel Spiegelconsultancy — toekomstkijksessies reserveren",
  "Lórien Mantels — maatwerk en onzichtbaarheidstests plannen",
  "Grijze Havens Cruises — afvaarten naar het Westen plannen",
  "Gandalf Vuurwerk & Advies — projecten en verdwijningen bewaken",
  "Schaduwvacht Express — bliksemsnelle ritten verdelen",
  "Arwen Bridal — passen, vlechten en elfenjurken plannen",
  "Rivendel Wellness — elfenmassages per eeuw inboeken",
  "Moria Echo Studios — opnames zonder trommels in de diepte",
  "Balrog Verwarming — storingsmonteurs brandveilig inroosteren",
  "Grottrol Sloopwerken — projecten met minimale nevenschade plannen",
  "Adelaars Luchtredding — vluchten pas op het laatste moment boeken",
  "Beorn Honing & Logies — berenvrije kamers reserveren",
  "Demsterwold Ongediertebestrijding — spinnenroutes plannen",
  "Thranduil Wijnkelders — vaten, proeverijen en ontsnappingen plannen",
  "Meerstad Vismarkt — kramen en visleveringen verdelen",
  "Bard Boogbeveiliging — wachtdiensten en drakendekking plannen",
  "Erebor Schatkistbeheer — audits per goudberg inroosteren",
  "Smaug Verwarming — afspraken zonder brandverzekering plannen",
  "Daal Speelgoedmakers — productie voor winterfeesten plannen",
  "IJzerheuvels Smederij — ovens, hamers en orders verdelen",
  "Blauwe Bergen Steenwerk — steenhouwers per gevel plannen",
  "Dwergen Vatenrace — wedstrijden en ziekenhuisbedden reserveren",
  "Erebor Deurenservice — geheime ingangen op maanstand plannen",
  "Thorin & Co Interim — dertien dwergen op één klus plaatsen",
  "Rohan Ruiterschool — lessen en paarden eerlijk verdelen",
  "Edoras Dakdekkers — rieten daken vóór de winter plannen",
  "Helmsdiepte Beveiliging — nachtwachten en ladders voorspellen",
  "Entenraad Bosbeheer — besluiten binnen één kwartaal afronden",
  "Fangorn Snoeiwerken — routes zonder levende bomen plannen",
  "Isengard Circulair Hout — herplanting achteraf inboeken",
  "Orthanc Telecom — palantírs en belkamers reserveren",
  "Saruman Witgoed — monteurs in vijf kleuren inroosteren",
  "Gríma Communicatie — crisisoverleggen en fluisterdiensten plannen",
  "BoomBaard Besluitvorming — extreem lange projecten faseren",
  "Éowyn Schildmaagd Training — lessen en oefenzwaarden plannen",
  "Théoden Paardenlease — reserveringen en koninklijke ritten bewaken",
  "Rohan Hooi & Voer — stallen en leveringen op elkaar afstemmen",
  "Éomer Bereden Koeriers — spoedritten door de Mark plannen",
  "Gouden Zaal Horeca — banketten en heldendichten reserveren",
  "Rohan Helmenpoets — ophaalroutes en glansbeurten plannen",
  "Westfold Alarmcentrale — meldingen vóór zonsopgang verdelen",
  "Wargvrije Wandelroutes — inspecteurs per bergpas plannen",
  "Gondor Vuurtorens — onderhoud zonder vals alarm plannen",
  "Minas Tirith Trappenservice — monteurs over zeven niveaus verdelen",
  "Witte Boom Hoveniers — één heel belangrijke boom verzorgen",
  "Denethor Tomatencatering — keukenplanning zonder drama",
  "Faramir Rangers — patrouilles en hinderlagen inroosteren",
  "Ithilien Picknickservice — manden buiten bereik van olifanten plannen",
  "Osgiliath Bruggenbouw — bouwfasen tussen twee legers plannen",
  "Dol Amroth Zwanenboten — vloot en bemanning reserveren",
  "Citadel Archief — wachtrijen voor oude rollen plannen",
  "Beregond Nachtwacht — diensten en geheime pauzes verdelen",
  "Palantír Videobellen — vergaderkamers zonder Sauron plannen",
  "Raad van Elrond Consultancy — meetings met maximaal negen deelnemers",
  "Midden-aarde Landmeters — meetploegen en kaarten verdelen",
  "Gezelschap Expedities — negen agenda's eindelijk gelijk leggen",
  "Eén Ring Juwelenreparatie — anonieme afspraken inboeken",
  "Mordor Human Resources — tienduizend orks eerlijk inroosteren",
  "Sauron EyeCare — oogmetingen en torendiensten plannen",
  "Barad-dûr Facility Services — onderhoud aan één hoge toren",
  "Doemberg Gieterij — ovens en ringproductie bewaken",
  "Negen Nazgûl Taxi — ritten zonder dubbelboeking verdelen",
  "Ork & Roll Uitzendbureau — brullende flexkrachten plaatsen",
  "Uruk-hai Sprintcoaches — trainingen tot zonsopgang plannen",
  "Shelob Webhosting — serveronderhoud tussen voedertijden",
  "Gollum Ring Recovery — zoekteams en vispauzes plannen",
  "Dode Moerassen Spa — behandelingen en dwaallichtjes boeken",
  "Zwarte Poort Logistics — tijdsloten voor enorme legers plannen",
  "Harad Olifantenverhuur — mûmakils en bestuurders reserveren",
  "Umbar Kapersrederij — schepen en aanlegplaatsen verdelen",
  "Rhûn Karavaanservice — routes door het Oosten plannen",
  "Angmar Winterdienst — sneeuwploegen en spoken inroosteren",
  "Warg Walkers — uitlaatdiensten met extra sterke lijnen",
  "Tom Bombadil Events — zangblokken zonder eindtijd plannen",
]

const DEMO_MEMBER_IDS = DEMO_MEMBERS.map(member => member.id)

function buildRequestItem(title: string, index: number): BoardItem {
  const ownerIndex = index % DEMO_MEMBER_IDS.length
  // Status varieert per ronde in plaats van per persoon. Daardoor heeft
  // ieder teamlid een natuurlijke mix van afgerond, lopend en toekomstig
  // werk; voorheen kreeg dezelfde persoon tien keer vrijwel dezelfde fase.
  const round = Math.floor(index / DEMO_MEMBER_IDS.length)
  const status = round < 2 ? 'Done' : round === 2 ? 'Stuck' : round < 6 ? 'Working on...' : 'Not started'
  const startOffset = status === 'Done'
    ? -34 + round * 8 + (ownerIndex % 4)
    : status === 'Not started'
      ? 6 + (round - 6) * 7 + (ownerIndex % 5)
      : -5 + (round - 2) * 3 + (ownerIndex % 4)
  const endOffset = startOffset + 1 + ((index + ownerIndex) % 3)
  const owner = DEMO_MEMBER_IDS[ownerIndex]
  const owners = index % 13 === 0
    ? [owner, DEMO_MEMBER_IDS[(index + 3) % DEMO_MEMBER_IDS.length]]
    : [owner]
  return item(`i${index + 1}`, title, owners, status, {
    startOffset,
    endOffset,
    estHours: 5 + ((index * 3 + ownerIndex) % 8),
    deadlineOffset: status === 'Done' ? undefined : endOffset + 1,
  })
}

function buildRequestGroups(from: number, to: number, color: string): BoardGroup[] {
  const requests = DEMO_REQUESTS.slice(from, to).map((title, localIndex) => buildRequestItem(title, from + localIndex))
  return [
    { id: 'g1', name: 'Nieuwe aanvragen', color, items: requests.filter(request => request.status === 'Not started') },
    { id: 'g2', name: 'In aanbouw', color: '#D8935B', items: requests.filter(request => request.status === 'Working on...' || request.status === 'Stuck') },
    { id: 'g3', name: 'Done', color: '#9A9590', items: requests.filter(request => request.status === 'Done') },
  ]
}

export function buildDemoBoards(): Record<string, { groups: BoardGroup[] }> {
  return {
    'De Gouw & Bree': { groups: buildRequestGroups(0, 34, '#B0C6EB') },
    'Rivendel & Rohan': { groups: buildRequestGroups(34, 67, '#D8935B') },
    'Gondor & Mordor': { groups: buildRequestGroups(67, 100, '#5FA8A0') },
  }
}

// De fixtures leven in localStorage zodat bezoekers in de demo kunnen
// slepen en wijzigen. Bij een inhoudelijke fixture-update verversen we die
// basis eenmalig; daarna blijven hun wijzigingen gewoon bewaard.
const DEMO_BOARD_SEED_VERSION = 'fantasy-balanced-v2'

export function ensureCurrentDemoBoardSeed(): void {
  if (typeof window === 'undefined') return
  const versionKey = 'yoko-demo-board-seed-version'
  if (window.localStorage.getItem(versionKey) === DEMO_BOARD_SEED_VERSION) return
  const boards = buildDemoBoards()
  for (const [boardName, board] of Object.entries(boards)) {
    window.localStorage.setItem(`yoko-board-${boardName}`, JSON.stringify(board.groups))
    window.localStorage.removeItem(`yoko-board-${boardName}-dirty`)
  }
  window.localStorage.setItem(versionKey, DEMO_BOARD_SEED_VERSION)
}

export const DEMO_TODOS = [
  { id: 'dt1', text: 'Controleren of de Nazgûl allemaal een rijbewijs hebben', done: false },
  { id: 'dt2', text: 'Pikachu vragen waarom de palantír weer offline is', done: false },
  { id: 'dt3', text: 'Tweede ontbijt als standaard pauz toevoegen', done: true },
  { id: 'dt4', text: 'Pippi koppelen aan de Barad-dûr-kickoff', done: false },
  { id: 'dt5', text: 'Moffel waarschuwen voor de Balrog-deadline', done: false },
  { id: 'dt6', text: 'Bassie en Adriaan uit dezelfde tijdlijn halen', done: true },
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
    content: 'Kleuren, typografie en logo-gebruik voor De Steigerende Pony. Let op: Mordor-zwart is geen accentkleur.',
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
