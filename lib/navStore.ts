// Persists the sidebar nav sections (Docs + Projects) to localStorage so they can be renamed / reordered / extended

export type NavItem = {
  id:    string
  label: string
  href:  string
  icon?: string
  color?: string
  // Optioneel: beperk zichtbaarheid in de sidebar tot deze member-ID's.
  // Ontbreekt dit veld, dan is 't item voor iedereen zichtbaar (bestaand
  // gedrag). Dit is puur UX — de echte beveiliging zit server-side in de
  // Supabase RLS-policy van de onderliggende data (zie bv. budget_entries).
  visibleTo?: string[]
}

export type NavSection = {
  id:    string
  label: string
  items: NavItem[]
}

const DOCS_KEY     = 'yoko-nav-docs'
const PROJECTS_KEY = 'yoko-nav-projects'

const DEFAULT_DOCS: NavItem[] = [
  { id: 'team',        label: 'Team',        href: '/team',        icon: '👥' },
  { id: 'team-admin',  label: 'Team beheren', href: '/team-admin',  icon: '⚙️' },
  { id: 'kantoor',     label: 'Kantoor',     href: '/kantoor',     icon: '🏢' },
  { id: 'budget',      label: 'Budget',      href: '/budget',      icon: '💰', visibleTo: ['menno', 'vincent'] },
  { id: 'accounts',    label: 'Accounts',    href: '/accounts',    icon: '🔑' },
  { id: 'papierbak',   label: 'Papierbak',   href: '/papierbak',   icon: '🗑' },
  { id: 'snapshots',   label: 'Geschiedenis', href: '/geschiedenis', icon: '📜' },
]

const DEFAULT_PROJECTS: NavItem[] = [
  { id: 'yoko',       label: 'yoko',       href: '/projects/yoko',       color: '#579bfc' },
  { id: 'pnp',        label: 'PnP',        href: '/projects/pnp',        color: '#e2445c' },
  { id: 'nederland',  label: 'Nederland',  href: '/projects/nederland',  color: '#9c7ee8' },
  { id: 'vlaanderen', label: 'Vlaanderen', href: '/projects/vlaanderen', color: '#ff7a00' },
  { id: 'dienjaar',   label: 'Dienjaar',  href: '/projects/dienjaar',   color: '#00c875' },
]

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function save(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val))
}

export function loadDocs():     NavItem[] { return load(DOCS_KEY,     DEFAULT_DOCS)     }
export function loadProjects(): NavItem[] { return load(PROJECTS_KEY, DEFAULT_PROJECTS) }

export function saveDocs(items: NavItem[])     { save(DOCS_KEY,     items) }
export function saveProjects(items: NavItem[]) { save(PROJECTS_KEY, items) }

// ─── Unified sidebar sections (dynamic folders) ───────────────────────────────
export type SidebarSection = {
  id:    string
  name:  string
  type:  'docs' | 'projects' | 'folder' | 'pages'
  items: NavItem[]
}

const SECTIONS_KEY = 'yoko-sidebar-sections-v3'

function defaultSections(): SidebarSection[] {
  return [
    { id: 'agendas', name: "Agenda's",   type: 'projects', items: load(PROJECTS_KEY, DEFAULT_PROJECTS) },
    { id: 'pagina',  name: "Pagina's",   type: 'docs',     items: load(DOCS_KEY,     DEFAULT_DOCS)     },
    { id: 'docs2',   name: 'Documenten', type: 'pages',    items: [] },
  ]
}

// Nieuwe DEFAULT_DOCS-items (zoals 'Budget') die na een release worden
// toegevoegd, missen anders in de al-gecachte localStorage-sections van
// bestaande gebruikers — loadSections() valt alleen terug op de defaults
// als er HELEMAAL niks gecached is. Hier vullen we ontbrekende ids aan
// zonder de gebruiker z'n eigen volgorde/hernoemingen/verwijderingen van
// bestaande items te verstoren.
function reconcileDocsItems(sections: SidebarSection[]): SidebarSection[] {
  const docs = sections.find(s => s.id === 'pagina')
  if (!docs) return sections
  const existingIds = new Set(docs.items.map(i => i.id))
  const missing = DEFAULT_DOCS.filter(d => !existingIds.has(d.id))
  if (missing.length === 0) return sections
  return sections.map(s => s.id === 'pagina' ? { ...s, items: [...s.items, ...missing] } : s)
}

export function loadSections(): SidebarSection[] {
  if (typeof window === 'undefined') return defaultSections()
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (raw) return reconcileDocsItems(JSON.parse(raw) as SidebarSection[])
  } catch {}
  return defaultSections()
}

export function saveSections(sections: SidebarSection[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
  window.dispatchEvent(new CustomEvent('yoko-nav-update'))
}
