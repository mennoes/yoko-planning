export type TeamMember = {
  id: string
  name: string
  weeklyCapacity: number
  color: string
}

export type Project = {
  id: string
  name: string
  board: string
  group?: string
  ownerIds: string[]
  startDate: string | null
  endDate: string | null
  // HH:MM strings (24-uurs) wanneer er een specifieke tijd bekend is —
  // Google-events met dateTime krijgen hem mee, all-day blijft null. De
  // Week-zoom in Planning gebruikt 'm voor uur-positionering.
  startTime?: string | null
  endTime?:   string | null
  estHours: number
  ownerHours?: Record<string, number>   // optional per-owner hours override
  status: 'active' | 'done'
  source?: 'manual' | 'google'
  externalLink?: string
  externalSyncedAt?: string
  meetLink?: string
  // Set on virtual projects produced by merging same-name Google items in
  // the planner. The detail panel uses it to render a sub-event list.
  mergedFrom?: Project[]
  // Wanneer dit project is afgeleid van een subitem onder een parent-item:
  // de naam van de parent. Gebruikt door planning-popovers zodat duidelijk
  // is bij welke parent de subitem hoort.
  parentName?: string
}

import { getBoardColor } from './boardsRegistry'
import type { BoardGroup } from './boards'
import { isVrijTitle, loadCategoryOverrides } from './workloadCategory'
// Proxy zodat code als BOARD_COLORS[boardId] blijft werken, maar nu
// dynamisch op de registry. Toegevoegde borden krijgen hun eigen kleur
// uit de boards-tabel; onbekende keys vallen terug op grijs.
export const BOARD_COLORS = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) { return getBoardColor(prop) },
})

// Bouw een vlakke project-lijst uit bord-groepen. Subitems die hun eigen
// startDate/endDate hebben (typisch: recurring Google-events, één per
// instance) worden als afzonderlijke projects gerenderd zodat ze in de
// werkdruk-widget op de juiste dag landen met de juiste duur — anders
// zou bv. 'Weekstart (34×)' als één multi-week-project van 28 mrt t/m
// 24 mei tellen i.p.v. een half-uurtje per maandag.
//
// Subitems zonder eigen datums vallen onder de parent: we sommeren hun
// uren en gebruiken de parent-datums. Subitems met status='Done' slaan
// we over zodat afgevinkte instances niet meer in totalen meetellen.
export function groupsToProjects(boardName: string, groups: BoardGroup[]): Project[] {
  const projects = groups.flatMap(g =>
    g.items
      .flatMap((i): Project[] => {
        const subs = (i.subitems as Array<{ id?: string; name?: string; estHours?: number; startDate?: string | null; endDate?: string | null; startTime?: string | null; endTime?: string | null; ownerIds?: string[]; status?: string; meetLink?: string; externalLink?: string | null; source?: 'manual' | 'google'; googleSeriesId?: string }> | undefined) ?? []
        // Subitems mét eigen datums → eigen Project per subitem. Done blijft
        // erbij maar krijgt status='done' zodat 'ie in de planning faded
        // wordt i.p.v. te verdwijnen (anders 'verdwijnen items zomaar' bij
        // een Done-tik).
        //
        // BELANGRIJK: we gebruiken hier de index uit de ORIGINELE subs-
        // array (origIdx), niet uit de gefilterde lijst. Anders verwijst
        // project.id = '__siN' naar de verkeerde subitem in handleDetail
        // Update / handleDragEnd (die kijken naar subs[N] direct).
        const subsWithDates = subs
          .map((si, origIdx) => ({ si, origIdx }))
          .filter(({ si }) => si.startDate || si.endDate)
        let attachedMeetings: Project[] = []
        if (subsWithDates.length > 0) {
          const datedProjects = subsWithDates.map(({ si, origIdx }): Project => {
            // Subitem-ownerIds gebruiken we alleen als 't ECHT toegewezen is
            // (niet leeg en niet alleen 'unassigned'). Anders valt-ie terug
            // op de parent-owners — anders telt een 'unassigned'-subitem 0u
            // voor de parent-owner in de werkdruk, terwijl de parent zelf
            // wel iemand als verantwoordelijke heeft staan. Bug die zorgde
            // dat items met onbenoemde subitems uit Home/Werkdruk vielen.
            const subOwners = (si.ownerIds ?? []).filter(o => o && o !== 'unassigned')
            const parentOwners = (Array.isArray(i.ownerIds) ? (i.ownerIds as string[]) : [])
              .filter(o => o && o !== 'unassigned')
            const owners = subOwners.length > 0
              ? (si.ownerIds as string[])
              : parentOwners.length > 0
                ? (i.ownerIds as string[])
                : ['unassigned']  // valt door naar de Unassigned-rij in /planning
            return {
              id:        `${boardName}__${i.id}__si${origIdx}`,
              // Subitem-bar toont alleen de subitem-naam — niet "Parent ·
              // Subitem". User vond 't dubbel: "het hoofditem staat er nu
              // ook". Subitem-naam is meestal duidelijk genoeg op zichzelf
              // ('Boekomslag v2'); voor extra context kun je 'm openklikken.
              // Bestaande subitems hebben mogelijk nog 'wo 3 jun' (date-
              // label) als naam uit een vorige sync. Detecteer dat patroon
              // en val terug op parent-naam zodat we niet wachten op de
              // volgende sync-write.
              name:      (si.name && !/^[a-z]{2,3}\s+\d{1,2}(\s+[a-z.]+)?$/i.test(si.name.trim()))
                           ? si.name
                           : (i.name as string),
              board:     boardName,
              group:     g.name,
              ownerIds:  owners,
              startDate: si.startDate ?? null,
              endDate:   si.endDate ?? si.startDate ?? null,
              startTime: si.startTime ?? null,
              endTime:   si.endTime ?? null,
              estHours:  Number(si.estHours) || 0,
              // Done op de subitem zelf óf op de parent telt als done —
              // beide krijgen in de planning een fade i.p.v. weg.
              status:    ((si.status ?? '') === 'Done' || (i.status as string) === 'Done') ? 'done' : 'active',
              source:    si.source ?? (i.source as 'manual' | 'google' | undefined),
              externalLink: si.externalLink ?? (i.externalLink as string | undefined),
              externalSyncedAt: (i.externalSyncedAt as string | undefined),
              meetLink:  ((si as { meetLink?: string }).meetLink) ?? (i.meetLink as string | undefined),
              parentName: i.name as string,
            }
          })
          if (subsWithDates.some(({ si }) => !si.googleSeriesId)) return datedProjects
          // Auto-attached meetings are extra work, not a breakdown of the
          // project's existing estimate. Adding a 1h meeting must not make
          // a previously planned 40h project disappear from the workload.
          attachedMeetings = datedProjects
        }
        const activeSubs = subs.filter(si => !si.googleSeriesId && (si.status ?? '') !== 'Done')
        const hours = activeSubs.length > 0
          ? activeSubs.reduce((s, si) => s + (Number(si.estHours) || 0), 0)
          : (Number(i.estHours) || 0)
        // Owners zonder eigenaar landen op 'unassigned' zodat ze in de
        // planning onder de Unassigned-rij verschijnen i.p.v. uit beeld
        // te verdwijnen.
        const rawOwners = (Array.isArray(i.ownerIds) ? (i.ownerIds as string[]) : []).filter(o => o && o !== 'unassigned')
        const ownerIds = rawOwners.length > 0 ? (i.ownerIds as string[]) : ['unassigned']
        return [...attachedMeetings, {
          id: `${boardName}__${i.id}`,
          name: i.name as string,
          board: boardName,
          group: g.name,
          ownerIds,
          startDate: i.startDate as string | null,
          endDate:   i.endDate   as string | null,
          startTime: (i.startTime as string | null | undefined) ?? null,
          endTime:   (i.endTime   as string | null | undefined) ?? null,
          estHours:  hours,
          ownerHours: (i.ownerHours as Record<string, number> | undefined),
          status:    (i.status as string) === 'Done' ? 'done' : 'active',
          source:        (i.source as 'manual' | 'google' | undefined),
          externalLink:  (i.externalLink as string | undefined),
          externalSyncedAt: (i.externalSyncedAt as string | undefined),
          meetLink:      (i.meetLink as string | undefined),
        }]
      })
  )

  // Oudere sync-rijen kunnen nog geen source='google' hebben, terwijl de
  // synchronisatietijd of Calendar-link wel ondubbelzinnig laat zien dat ze
  // uit Google komen. Normaliseer die eerst; anders belandt de nieuwe rij in
  // de G-teller en blijft de legacy-rij daarnaast als gewone gekleurde balk
  // staan — dezelfde afspraak wordt dan twee keer getoond.
  const isGoogleBacked = (p: Project): boolean =>
    p.source === 'google' ||
    /__it_g_|__gcal_/i.test(p.id) ||
    Boolean(p.meetLink) ||
    Boolean(p.externalSyncedAt) ||
    /(^|\.)(calendar|meet)\.google\.com$/i.test(safeHost(p.externalLink)) ||
    (/^(www\.)?google\.com$/i.test(safeHost(p.externalLink)) && /\/calendar\//i.test(safePath(p.externalLink)))
  const normalizedProjects = projects.map(p =>
    isGoogleBacked(p) && p.source !== 'google' ? { ...p, source: 'google' as const } : p)

  // Google kan bij een wijziging in deelnemers dezelfde afspraak tijdelijk
  // onder een nieuwe technische serie-ID aanbieden. Dedupliceren op iCalUID
  // helpt dan niet, maar de daadwerkelijke occurrence is nog steeds gelijk:
  // dezelfde titel, datum en tijd. Toon daarvan alleen de laatst gesyncte rij.
  // Handmatige items blijven volledig buiten deze deduplicatie.
  const winnerByOccurrence = new Map<string, Project>()
  const occurrenceKey = (p: Project): string | null => {
    if (!isGoogleBacked(p) || (!p.startDate && !p.endDate)) return null
    const title = p.name.toLowerCase().trim().replace(/\s*\(\d+\s*[x×]\)\s*$/u, '')
    return [title, p.startDate ?? '', p.endDate ?? '', p.startTime ?? '', p.endTime ?? ''].join('|')
  }
  const syncTime = (p: Project): number => {
    const ms = p.externalSyncedAt ? Date.parse(p.externalSyncedAt) : 0
    return Number.isFinite(ms) ? ms : 0
  }
  for (const project of normalizedProjects) {
    const key = occurrenceKey(project)
    if (!key) continue
    const current = winnerByOccurrence.get(key)
    if (!current || syncTime(project) > syncTime(current) ||
        (syncTime(project) === syncTime(current) && project.id < current.id)) {
      winnerByOccurrence.set(key, project)
    }
  }
  return normalizedProjects.filter(project => {
    const key = occurrenceKey(project)
    return !key || winnerByOccurrence.get(key)?.id === project.id
  })
}

function safeHost(url: string | undefined): string {
  if (!url) return ''
  try { return new URL(url).hostname }
  catch { return '' }
}

function safePath(url: string | undefined): string {
  if (!url) return ''
  try { return new URL(url).pathname }
  catch { return '' }
}

/** Returns the Monday of the week containing `date` */
export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

/** Returns an array of `count` week-start Dates, starting from `from` */
export function getWeeks(from: Date, count: number): Date[] {
  const start = getWeekStart(from)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i * 7)
    return d
  })
}

const NL_MONTHS = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

/** ISO week number (Mon = start of week) */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export type WeekLabel = {
  weekNum: string   // "W18"
  range: string     // "apr. 27 – 3"
  weekStart: Date
  isCurrentWeek: boolean
}

export function getWeekLabel(weekStart: Date): WeekLabel {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const startDay   = weekStart.getDate()
  const startMonth = NL_MONTHS[weekStart.getMonth()]
  const endDay     = weekEnd.getDate()
  const endMonth   = NL_MONTHS[weekEnd.getMonth()]

  const range =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${startMonth}. ${startDay} – ${endDay}`
      : `${startMonth}. ${startDay} – ${endDay} ${endMonth}.`

  const now = new Date()
  const isCurrentWeek =
    weekStart <= now && now < new Date(weekStart.getTime() + 7 * 86400000)

  return {
    weekNum: `W${isoWeekNumber(weekStart)}`,
    range,
    weekStart,
    isCurrentWeek,
  }
}

export type ProjectContribution = {
  project: Project
  hours: number
}

// Telt het aantal werkdagen (Ma-Vr) tussen twee datums inclusief beide
// uiteinden — minus eventuele off-days voor `memberId` (statische vrije
// weekdagen via daysOffStore + dynamische Vrij-events via vrijDays).
//   - Weekend altijd uitgesloten.
//   - memberId optioneel: zonder member checken we alleen Ma-Vr.
function countWorkdays(startMs: number, endMs: number, memberId?: string): number {
  if (endMs < startMs) return 0
  let count = 0
  const oneDay = 86400000
  const start = new Date(startMs); start.setHours(0, 0, 0, 0)
  const end   = new Date(endMs);   end.setHours(0, 0, 0, 0)
  // Days-off filter UITGESCHAKELD voor uren-distributie. Was bron van
  // 'maandag toont niks' wanneer de localStorage-cache ergens stale of
  // verkeerd was. Weekend-skip blijft. Voor de zichtbare dim-stripe op
  // off-days check ik elders rechtstreeks profilesById.
  void memberId
  const off: number[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += oneDay) {
    const d = new Date(t)
    const dow = d.getDay()                       // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) continue          // weekend altijd uit
    if (memberId) {
      const iso = dow === 0 ? 7 : dow             // ISO weekday 1..7
      if (off.includes(iso)) continue             // statische vrije dag
      // Dynamische Vrij-event via lazy require om circular imports te
      // vermijden. vrijDays.ts cached zelf in module-scope.
      try {
        const { isVrijDayForMember } = require('./vrijDays') as typeof import('./vrijDays')
        if (isVrijDayForMember(memberId, d)) continue
      } catch {}
    }
    count++
  }
  return count
}

/**
 * Hours a specific project contributes to `memberId` in the week starting `weekStart`.
 * Hours are distributed evenly across WORKING DAYS (Mon-Fri) of the project timeline,
 * then the overlap with the given week is taken, split equally among owners.
 */
export function projectHoursInWeek(
  project: Project,
  memberId: string,
  weekStart: Date,
  // Category-override voor dit project ('vrij' | 'meeting' | ... | undefined).
  // Zonder deze param viel de vrij-detectie hieronder terug op alleen
  // naam-patroon-matching — items die de gebruiker via de planning-popup
  // hándmatig op 'vrij' heeft gezet (bv. 'Zwitserland' i.p.v. 'Vakantie')
  // werden dan gemist en telden 0u i.p.v. hun echte uren. Optioneel zodat
  // bestaande callers die 'm niet meegeven gewoon op naam-matching vallen.
  categoryOverride?: string | null,
): number {
  if (!project.ownerIds.includes(memberId)) return 0
  if (project.estHours === 0) return 0
  if (!project.startDate || !project.endDate) return 0

  // Per-owner override: if ownerHours[memberId] is set, that's this owner's
  // share. Otherwise split estHours evenly across owners.
  const myShare = project.ownerHours && memberId in project.ownerHours
    ? Number(project.ownerHours[memberId]) || 0
    : project.estHours / Math.max(project.ownerIds.length, 1)
  if (myShare === 0) return 0

  const pStart = new Date(project.startDate)
  const pEnd   = new Date(project.endDate)
  pEnd.setHours(23, 59, 59, 999)

  const wStart = new Date(weekStart)
  const wEnd   = new Date(weekStart)
  wEnd.setDate(wEnd.getDate() + 6)
  wEnd.setHours(23, 59, 59, 999)

  // No overlap
  if (wEnd < pStart || wStart > pEnd) return 0

  const overlapStart = wStart > pStart ? wStart : pStart
  const overlapEnd   = wEnd   < pEnd   ? wEnd   : pEnd

  // Verdeel over dezelfde werkdagen die de planning daadwerkelijk toont.
  // De oude kalenderdag-noemer telde weekenden wel mee, terwijl die dagen
  // vervolgens nergens uren kregen. Daardoor werd bv. 10u van ma-zo als
  // slechts 7,1u zichtbaar. Met dezelfde filter voor totaal én overlap
  // blijft de som over alle zichtbare cellen exact gelijk aan myShare.
  //
  // Vrij is geen werkbijdrage: het verlaagt capaciteit, maar wordt niet als
  // gewerkte uren bij het totaal opgeteld.
  //
  // Gebruikte vroeger een eigen los regex-patroon hier, dat niet 1-op-1
  // overeenkwam met de canonieke VRIJ_PATTERNS in lib/workloadCategory.ts
  // (miste bv. 'ziek', 'thuiswerken', losse 'Pinksterdag' zonder 'tweede').
  // Zo'n item werd overal ELDERS in de app (todo-filter, categorie-badge,
  // balk-hoogte) wél als vrij herkend, maar hier niet — met 0u als gevolg
  // op precies de dagen die countWorkdays dan alsnog wegskipte. isVrijTitle
  // is nu de ENIGE bron van waarheid voor naam-matching; plus de expliciete
  // category-override én de GROEPSNAAM (zelfde regel als isVrijDayForMember
  // in lib/vrijDays.ts) voor namen die geen enkel patroon raken, zoals
  // 'Zwitserland' in een groep 'Vrij'. Reproduceerbaar bevestigd: zonder
  // de groepsnaam-check verdween zo'n item volledig (0u) uit de
  // werkdruk-totalen, terwijl isVrijDayForMember het lid op die exacte
  // dagen al wél als 'vrij' had gemarkeerd via die groepsnaam.
  const isVrij = categoryOverride === 'vrij' || isVrijTitle(project.name) || (project.group ?? '').toLowerCase().includes('vrij')
  if (isVrij) return 0
  const totalProjectWork = countWorkdays(pStart.getTime(), pEnd.getTime(), memberId)
  const overlapWork = countWorkdays(overlapStart.getTime(), overlapEnd.getTime(), memberId)
  if (overlapWork === 0) return 0

  const fraction        = overlapWork / Math.max(1, totalProjectWork)
  const result          = fraction * myShare

  return Math.round(result * 10) / 10
}

/** All project contributions for one member in one week */
export function memberContributions(
  projects: Project[],
  memberId: string,
  weekStart: Date,
): ProjectContribution[] {
  // Eén keer laden i.p.v. per project — dit loopt over alle projects ×
  // members × weken in de planning-grid, dus een localStorage-read per
  // item zou nodeloos vaak herhalen.
  const overrides = loadCategoryOverrides()
  return projects
    .map(p => ({ project: p, hours: projectHoursInWeek(p, memberId, weekStart, overrides[p.id]) }))
    .filter(c => c.hours > 0)
}

/** Total hours for one member in one week */
export function memberTotalHours(
  projects: Project[],
  memberId: string,
  weekStart: Date,
): number {
  return memberContributions(projects, memberId, weekStart)
    .reduce((s, c) => s + c.hours, 0)
}
