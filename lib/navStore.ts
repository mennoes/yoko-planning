// Persists the sidebar nav sections (Docs + Projects) to localStorage so they can be renamed / reordered / extended

export type NavItem = {
  id:    string
  label: string
  href:  string
  icon?: string
  color?: string
}

export type NavSection = {
  id:    string
  label: string
  items: NavItem[]
}

const DOCS_KEY     = 'yoko-nav-docs'
const PROJECTS_KEY = 'yoko-nav-projects'

const DEFAULT_DOCS: NavItem[] = [
  { id: 'team',     label: 'Team',     href: '/team',     icon: '👥' },
  { id: 'kantoor',  label: 'Kantoor',  href: '/kantoor',  icon: '🏢' },
  { id: 'accounts', label: 'Accounts', href: '/accounts', icon: '🔑' },
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
  type:  'docs' | 'projects' | 'folder'
  items: NavItem[]
}

const SECTIONS_KEY = 'yoko-sidebar-sections-v2'

function defaultSections(): SidebarSection[] {
  return [
    { id: 'docs',    name: 'Documenten', type: 'docs',     items: load(DOCS_KEY,     DEFAULT_DOCS)     },
    { id: 'agendas', name: "AGENDA's",   type: 'projects', items: load(PROJECTS_KEY, DEFAULT_PROJECTS) },
  ]
}

export function loadSections(): SidebarSection[] {
  if (typeof window === 'undefined') return defaultSections()
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (raw) return JSON.parse(raw) as SidebarSection[]
  } catch {}
  return defaultSections()
}

export function saveSections(sections: SidebarSection[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
  window.dispatchEvent(new CustomEvent('yoko-nav-update'))
}
