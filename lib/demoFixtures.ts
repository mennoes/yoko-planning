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

// ─── Team ───────────────────────────────────────────────────────────────────
export const DEMO_MEMBERS: TeamMember[] = [
  { id: 'demo-sam',   name: 'Sam',   email: '', color: '#B0C6EB', weeklyCapacity: 40, position: 0, hidden: false, kind: 'yoko',        startDate: null },
  { id: 'demo-robin', name: 'Robin', email: '', color: '#9DB1A4', weeklyCapacity: 32, position: 1, hidden: false, kind: 'yoko',        startDate: null },
  { id: 'demo-jules', name: 'Jules', email: '', color: '#C09BCA', weeklyCapacity: 40, position: 2, hidden: false, kind: 'freelance',  startDate: null },
  { id: 'demo-noa',   name: 'Noa',   email: '', color: '#D8B62E', weeklyCapacity: 24, position: 3, hidden: false, kind: 'yoko',        startDate: null },
]

export const DEMO_PROFILE: UserProfile = {
  memberId: 'demo-sam', name: 'Sam', color: '#B0C6EB', photo: null,
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
