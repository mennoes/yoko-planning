export type ColumnType = 'text' | 'number' | 'date' | 'daterange' | 'owners' | 'status' | 'url' | 'currency'

export type SubItem = {
  id:           string
  name:         string
  ownerIds:     string[]
  status:       string
  startDate:    string | null
  endDate:      string | null
  // HH:MM-strings — alleen ingevuld bij Google-events met dateTime; bij
  // all-day events of handmatige subitems blijft 't null.
  startTime?:   string | null
  endTime?:     string | null
  // Google Meet-link wanneer 't event er één heeft (video-meetings).
  meetLink?:    string | null
  estHours:     number
  echtGewerkt?: number
}

export type ColumnDef = {
  key:   string
  label: string
  type:  ColumnType
  width: number
}

export type JournalEntry = {
  id:        string
  ts:        string  // ISO datetime
  text:      string
  authorId?: string
  reactions?: Record<string, string[]>   // emoji → member_id[]
}

export type BoardItem = {
  id:             string
  name:           string
  ownerIds:       string[]
  status:         string
  startDate:      string | null
  endDate:        string | null
  deadline:       string | null
  estHours:       number
  dagen:          number
  notes?:         string
  contactpersoon?: string
  uitzenddag?:    string | null
  framelink?:     string
  nummers?:       number
  subitems?:      SubItem[]
  journal?:       JournalEntry[]
  source?:        'manual' | 'google'   // origin of this item
  externalLink?:  string                // link back to source (e.g. Google Calendar event)
  ownerHours?:    Record<string, number>  // per-owner hour overrides for shared items
  links?:         ItemLink[]            // gekoppelde bestanden / externe URL's
  [key: string]:  unknown
}

export type ItemLink = {
  id:    string
  url:   string
  label?: string
}

export type BoardGroup = {
  id:         string
  name:       string
  color:      string
  collapsed?: boolean
  items:      BoardItem[]
}

export type BoardConfig = {
  id:      string
  name:    string
  emoji:   string
  color:   string
  columns: ColumnDef[]
}

// BOARD_CONFIGS is nu een Proxy bovenop de dynamische registry — bestaande
// code die `BOARD_CONFIGS['yoko']` doet blijft werken, maar nieuwe borden
// (toegevoegd via de + in de sidebar → boards-tabel) komen er automatisch
// bij zonder code-wijziging. Zie lib/boardsRegistry.ts voor de bron.
import { getBoardConfig, getBoards } from './boardsRegistry'
export const BOARD_CONFIGS = new Proxy({} as Record<string, BoardConfig>, {
  get(_t, prop: string) { return getBoardConfig(prop) ?? undefined },
  has(_t, prop: string) { return getBoardConfig(prop) != null },
  ownKeys() { return getBoards().map(b => b.id) },
  getOwnPropertyDescriptor(_t, prop: string) {
    const c = getBoardConfig(prop)
    return c ? { enumerable: true, configurable: true, value: c } : undefined
  },
})
