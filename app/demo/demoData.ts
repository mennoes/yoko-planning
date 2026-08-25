// Verzonnen data voor de publieke demo — GEEN echte klant- of teamnamen.
// Alles hier is fictief en bedoeld om de tool te laten zien op bv.
// LinkedIn, zonder ooit met echte Supabase-data of -accounts te praten.

export type DemoStatus = 'Not started' | 'Working on...' | 'Done'

export type DemoTask = {
  id:         string
  client:     string
  color:      string
  name:       string
  ownerIds:   string[]
  status:     DemoStatus
  // Dagen offset t.o.v. het seed-moment ('vandaag' bij eerste load) —
  // zo blijft de demo altijd rond 'nu' hangen, ongeacht wanneer iemand
  // 'm bezoekt.
  startOffset: number
  endOffset:   number
  estHours:    number
}

export type DemoMember = {
  id: string
  name: string
  color: string
  weeklyCapacity: number
}

export type DemoTodo = {
  id: string
  text: string
  done: boolean
}

export const DEMO_MEMBERS: DemoMember[] = [
  { id: 'm1', name: 'Sam',   color: '#B0C6EB', weeklyCapacity: 40 },
  { id: 'm2', name: 'Robin', color: '#9DB1A4', weeklyCapacity: 32 },
  { id: 'm3', name: 'Jules', color: '#C09BCA', weeklyCapacity: 40 },
  { id: 'm4', name: 'Noa',   color: '#D8B62E', weeklyCapacity: 24 },
]

const CLIENTS: { name: string; color: string }[] = [
  { name: 'Noorderlicht Media',  color: '#B0C6EB' },
  { name: 'Kaap Studio',         color: '#9DB1A4' },
  { name: 'Hemel & Aarde',       color: '#D8935B' },
]

// Elk item: [client-index, naam, ownerIds, status, startOffset, endOffset, estHours]
const TEMPLATE: [number, string, string[], DemoStatus, number, number, number][] = [
  [0, 'Merkfilm — script + storyboard', ['m1'],       'Done',          -9,  -3, 24],
  [0, 'Merkfilm — opnamedag',           ['m1', 'm2'], 'Done',          -2,  -2, 16],
  [0, 'Merkfilm — edit v1',             ['m2'],       'Working on...',  0,   6, 32],
  [0, 'Social cutdowns (5x)',           ['m4'],       'Not started',    8,  12, 14],
  [1, 'Huisstijl — moodboard',          ['m3'],       'Done',          -6,  -4, 10],
  [1, 'Huisstijl — logo-varianten',     ['m3'],       'Working on...', -1,   4, 20],
  [1, 'Website — wireframes',           ['m1', 'm3'], 'Not started',    5,  11, 28],
  [1, 'Website — launch prep',          ['m1'],       'Not started',   18,  24, 16],
  [2, 'Podcast S2 — aflevering 3 edit', ['m4'],       'Working on...', -3,   1, 12],
  [2, 'Podcast S2 — aflevering 4 edit', ['m4'],       'Not started',    4,   8, 12],
  [2, 'Cover-art volgende seizoen',     ['m2', 'm3'], 'Not started',    2,   3,  6],
  [2, 'Trailer volgend seizoen',        ['m2'],       'Not started',   14,  20, 18],
]

export function buildSeedTasks(): DemoTask[] {
  return TEMPLATE.map(([ci, name, ownerIds, status, startOffset, endOffset, estHours], i) => ({
    id: `t${i}`,
    client: CLIENTS[ci].name,
    color:  CLIENTS[ci].color,
    name, ownerIds, status, startOffset, endOffset, estHours,
  }))
}

export function buildSeedTodos(): DemoTodo[] {
  return [
    { id: 'd1', text: 'Facturen vorige maand versturen', done: false },
    { id: 'd2', text: 'Intake nieuwe klant voorbereiden', done: false },
    { id: 'd3', text: 'Feedback merkfilm-edit doorsturen', done: true },
  ]
}
