// Demo-variant van budgetStore.ts / projectRevenueStore.ts / revenueTemplateStore.ts
// samen — puur lokaal, NOOIT Supabase. Bewust in één bestand i.p.v. drie
// aparte, want elke functie hier is een simpele localStorage-lees/schrijf
// zonder remote-sync-complexiteit (geen pull/push/subscribe nodig — een
// demo-bezoeker deelt met niemand).
//
// Alle keys zijn 'yoko-demo-'-geprefixt zodat ze nooit met de echte
// (Supabase-backed) budget/omzet-caches kunnen botsen in dezelfde browser.
//
// Bedragen hier zijn puur fictief en gekoppeld aan de nep-klanten uit
// lib/demoFixtures.ts ('Noorderlicht Media', 'Kaap Studio') — nooit een
// echt Studio Yoko-bedrag.

export type DemoBudgetEntry = {
  id:        string
  memberId:  string
  quarter:   string   // 'YYYY-Q1'..'YYYY-Q4'
  amount:    number
  label?:    string
  createdAt: string
  updatedAt: string
}

export type DemoProjectRevenue = {
  itemId:    string  // `${boardId}__${item.id}` — zelfde vorm als de echte pagina
  boardId:   string
  amount:    number
  confirmed: boolean
  updatedAt: string
}

export type DemoRevenueTemplate = {
  pattern:       string
  boardId:       string
  defaultAmount: number
  updatedAt:     string
}

// Twee demo-teamleden vervullen hier de rol die 'menno'/'vincent' in de
// echte BUDGET_ALLOWED_MEMBER_IDS spelen — Sam (het standaard demo-profiel)
// en Jules, de twee demo-leden die in buildDemoBoards() het vaakst als
// owner voorkomen, zodat de pagina bij een eerste bezoek (profiel = Sam)
// meteen gevulde data toont i.p.v. een lege/'Geen toegang'-staat.
export const DEMO_BUDGET_ALLOWED_MEMBER_IDS = ['demo-sam', 'demo-jules']

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
export function genDemoBudgetId(): string { return genId('demobud') }

// ─── Kwartaal-helpers — zelfde pure logica als budgetStore.ts, hier los
// gehouden zodat dit bestand géén import-afhankelijkheid naar de
// Supabase-backed store heeft. ───────────────────────────────────────────
export function quarterOf(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1
  return `${date.getFullYear()}-Q${q}`
}
export function currentQuarter(): string {
  return quarterOf(new Date())
}
export function quarterRange(back: number, fwd: number): string[] {
  const now = new Date()
  const out: string[] = []
  for (let i = -back; i <= fwd; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i * 3, 1)
    out.push(quarterOf(d))
  }
  return out
}
export function quarterLabel(q: string): string {
  const [year, qq] = q.split('-Q')
  return `Q${qq} ${year}`
}

// ─── Budget-regels (losse omzet, niet aan een project gekoppeld) ─────────
const ENTRIES_KEY = 'yoko-demo-budget-entries-fantasy-v1'
const ENTRIES_EVENT = 'yoko-demo-budget-update'

function seedEntries(): DemoBudgetEntry[] {
  const now = new Date().toISOString()
  const q = currentQuarter()
  return [
    {
      id: genId('demobud'), memberId: 'demo-sam', quarter: q, amount: 1200,
      label: 'Spoedtoeslag — orks vóór zonsopgang gepland', createdAt: now, updatedAt: now,
    },
    {
      id: genId('demobud'), memberId: 'demo-jules', quarter: q, amount: 750,
      label: 'Extra workshop — tweede ontbijt automatiseren', createdAt: now, updatedAt: now,
    },
  ]
}

export function loadDemoBudgetEntries(): DemoBudgetEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(ENTRIES_KEY)
    if (raw) return JSON.parse(raw) as DemoBudgetEntry[]
    const seeded = seedEntries()
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(seeded))
    return seeded
  } catch { return [] }
}

function writeEntries(entries: DemoBudgetEntry[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent(ENTRIES_EVENT))
}

export function upsertDemoBudgetEntry(entry: DemoBudgetEntry): void {
  const current = loadDemoBudgetEntries()
  const next = current.some(e => e.id === entry.id)
    ? current.map(e => e.id === entry.id ? entry : e)
    : [...current, entry]
  writeEntries(next)
}

export function deleteDemoBudgetEntry(id: string): void {
  writeEntries(loadDemoBudgetEntries().filter(e => e.id !== id))
}

export function onDemoBudgetUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(ENTRIES_EVENT, handler)
  return () => window.removeEventListener(ENTRIES_EVENT, handler)
}

// ─── Project-omzet (gekoppeld aan een board-item) ─────────────────────────
const REVENUE_KEY = 'yoko-demo-project-revenue-fantasy-v1'
const REVENUE_EVENT = 'yoko-demo-project-revenue-update'

// itemId-vorm: `${boardId}__${item.id}`, zelfde als de echte pagina bouwt.
// Bedragen zijn fictief en horen bij items uit buildDemoBoards() in
// lib/demoFixtures.ts (owners demo-sam / demo-jules, dus zichtbaar onder
// DEMO_BUDGET_ALLOWED_MEMBER_IDS hierboven).
function seedRevenue(): DemoProjectRevenue[] {
  const now = new Date().toISOString()
  return [
    { itemId: 'De Gouw & Bree__i4',   boardId: 'De Gouw & Bree',   amount: 1800, confirmed: true,  updatedAt: now },
    { itemId: 'De Gouw & Bree__i6',   boardId: 'De Gouw & Bree',   amount: 950,  confirmed: true,  updatedAt: now },
    { itemId: 'De Gouw & Bree__i7',   boardId: 'De Gouw & Bree',   amount: 600,  confirmed: false, updatedAt: now },
    { itemId: 'Rivendel & Rohan__i35', boardId: 'Rivendel & Rohan', amount: 4200, confirmed: true,  updatedAt: now },
    { itemId: 'Rivendel & Rohan__i36', boardId: 'Rivendel & Rohan', amount: 8900, confirmed: false, updatedAt: now },
  ]
}

export function loadDemoProjectRevenue(): DemoProjectRevenue[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(REVENUE_KEY)
    if (raw) return JSON.parse(raw) as DemoProjectRevenue[]
    const seeded = seedRevenue()
    localStorage.setItem(REVENUE_KEY, JSON.stringify(seeded))
    return seeded
  } catch { return [] }
}

function writeRevenue(entries: DemoProjectRevenue[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(REVENUE_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent(REVENUE_EVENT))
}

export function upsertDemoProjectRevenue(entry: DemoProjectRevenue): void {
  const current = loadDemoProjectRevenue()
  const next = current.some(e => e.itemId === entry.itemId)
    ? current.map(e => e.itemId === entry.itemId ? entry : e)
    : [...current, entry]
  writeRevenue(next)
}

export function onDemoProjectRevenueUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(REVENUE_EVENT, handler)
  return () => window.removeEventListener(REVENUE_EVENT, handler)
}

// ─── Omzet-sjablonen (per herkend patroon) ────────────────────────────────
const TEMPLATES_KEY = 'yoko-demo-revenue-templates'
const TEMPLATES_EVENT = 'yoko-demo-revenue-template-update'

function templateKey(boardId: string, pattern: string): string {
  return `${boardId}::${pattern}`
}

export function loadDemoRevenueTemplates(): DemoRevenueTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    return raw ? (JSON.parse(raw) as DemoRevenueTemplate[]) : []
  } catch { return [] }
}

function writeTemplates(templates: DemoRevenueTemplate[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
  window.dispatchEvent(new CustomEvent(TEMPLATES_EVENT))
}

export function upsertDemoRevenueTemplate(t: DemoRevenueTemplate): void {
  const current = loadDemoRevenueTemplates()
  const k = templateKey(t.boardId, t.pattern)
  const next = current.some(x => templateKey(x.boardId, x.pattern) === k)
    ? current.map(x => templateKey(x.boardId, x.pattern) === k ? t : x)
    : [...current, t]
  writeTemplates(next)
}

export function onDemoRevenueTemplateUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(TEMPLATES_EVENT, handler)
  return () => window.removeEventListener(TEMPLATES_EVENT, handler)
}
