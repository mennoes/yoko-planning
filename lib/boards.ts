export type ColumnType = 'text' | 'number' | 'date' | 'daterange' | 'owners' | 'status' | 'url' | 'currency'

export type SubItem = {
  id:           string
  name:         string
  ownerIds:     string[]
  status:       string
  startDate:    string | null
  endDate:      string | null
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
  [key: string]:  unknown
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

export const BOARD_CONFIGS: Record<string, BoardConfig> = {
  yoko: {
    id: 'yoko', name: 'yoko', emoji: '📋', color: '#579bfc',
    columns: [
      { key: 'ownerIds',  label: 'Owner',    type: 'owners',    width: 90  },
      { key: 'status',    label: 'Status',   type: 'status',    width: 145 },
      { key: 'timeline',  label: 'Timeline', type: 'daterange', width: 175 },
      { key: 'deadline',  label: 'Deadline', type: 'date',      width: 105 },
      { key: 'estHours',  label: 'Est Time', type: 'number',    width: 85  },
      { key: 'dagen',     label: 'Dagen',    type: 'number',    width: 70  },
      { key: 'notes',     label: 'Notes',    type: 'text',      width: 160 },
    ],
  },
  pnp: {
    id: 'pnp', name: 'PnP', emoji: '📋', color: '#e2445c',
    columns: [
      { key: 'ownerIds',       label: 'Persoon',        type: 'owners',    width: 90  },
      { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
      { key: 'timeline',       label: 'Tijdlijn',       type: 'daterange', width: 175 },
      { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
      { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
      { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
      { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
    ],
  },
  nederland: {
    id: 'nederland', name: 'Nederland', emoji: '📋', color: '#9c7ee8',
    columns: [
      { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
      { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
      { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
      { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 175 },
      { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
      { key: 'uitzenddag',     label: 'Uitzenddag',     type: 'date',      width: 105 },
      { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
    ],
  },
  vlaanderen: {
    id: 'vlaanderen', name: 'Vlaanderen', emoji: '📋', color: '#ff7a00',
    columns: [
      { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90  },
      { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
      { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
      { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
      { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
      { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85  },
      { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70  },
      { key: 'framelink',      label: 'Frame link',     type: 'url',       width: 110 },
    ],
  },
  dienjaar: {
    id: 'dienjaar', name: 'Dienjaar', emoji: '📋', color: '#00c875',
    columns: [
      { key: 'ownerIds', label: 'Owner',    type: 'owners',    width: 90  },
      { key: 'timeline', label: 'Tijdlijn', type: 'daterange', width: 175 },
      { key: 'status',   label: 'Status',   type: 'status',    width: 145 },
      { key: 'estHours', label: 'Uren',     type: 'number',    width: 80  },
      { key: 'dagen',    label: 'Dagen',    type: 'number',    width: 70  },
      { key: 'deadline', label: 'Deadline', type: 'date',      width: 105 },
      { key: 'nummers',  label: 'Nummers',  type: 'currency',  width: 110 },
    ],
  },
}
