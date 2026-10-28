// Een klus uitzetten vanuit een sjabloon, zonder model.
//
// Je kiest het soort werk en de datum waarop het af moet, en hier komt
// dezelfde soort planning uit als de AI-variant maakt: een item met
// subitems, werkdagen en uren. Het verschil is dat dit niets begrijpt —
// het telt werkdagen terug vanaf de deadline. Juist daarom is het
// gratis, meteen klaar en gaat er niets de deur uit.
//
// De stappen van een sjabloon zijn een beginpunt, geen wet: in het
// scherm staan ze als tekst die je aanpast voor je iets aanmaakt.

import type { AiItemPlan, AiSubitemPlan } from './aiPlan'

export type SjabloonStap = { naam: string; dagen: number }
export type Sjabloon = { id: string; naam: string; stappen: SjabloonStap[] }

/** Acht uur in een werkdag; zelfde aanname als de rest van de app. */
export const UREN_PER_DAG = 8

/** Meer dan dit is geen planning meer maar een lijst. */
export const MAX_STAPPEN = 25

const DATUM = /^\d{4}-\d{2}-\d{2}$/

export const SJABLONEN: Sjabloon[] = [
  { id: 'explainer', naam: 'Explainer-video', stappen: [
    { naam: 'Script', dagen: 2 },
    { naam: 'Storyboard', dagen: 2 },
    { naam: 'Vormgeving', dagen: 3 },
    { naam: 'Animatie', dagen: 5 },
    { naam: 'Feedbackronde', dagen: 1 },
    { naam: 'Oplevering', dagen: 1 },
  ] },
  { id: 'podcast', naam: 'Podcast-aflevering', stappen: [
    { naam: 'Voorbereiding', dagen: 1 },
    { naam: 'Opname', dagen: 1 },
    { naam: 'Montage', dagen: 2 },
    { naam: 'Artwork', dagen: 1 },
    { naam: 'Publicatie', dagen: 1 },
  ] },
  { id: 'campagne', naam: 'Campagne', stappen: [
    { naam: 'Concept', dagen: 2 },
    { naam: 'Vormgeving', dagen: 3 },
    { naam: 'Uitwerking per kanaal', dagen: 3 },
    { naam: 'Feedbackronde', dagen: 1 },
    { naam: 'Aanlevering', dagen: 1 },
  ] },
  { id: 'ontwerp', naam: 'Ontwerp', stappen: [
    { naam: 'Moodboard', dagen: 1 },
    { naam: 'Eerste ontwerp', dagen: 3 },
    { naam: 'Feedbackronde', dagen: 1 },
    { naam: 'Uitwerking', dagen: 2 },
    { naam: 'Oplevering', dagen: 1 },
  ] },
  { id: 'leeg', naam: 'Eigen stappen', stappen: [
    { naam: 'Voorbereiding', dagen: 1 },
    { naam: 'Uitvoering', dagen: 3 },
    { naam: 'Oplevering', dagen: 1 },
  ] },
]

/** De stappen als tekst om in een veld te zetten: één per regel, met
 *  het aantal werkdagen erachter. */
export function stappenNaarTekst(stappen: SjabloonStap[]): string {
  return stappen.map(stap => `${stap.naam} · ${stap.dagen}d`).join('\n')
}

/**
 * Tekst terug naar stappen. Eén regel per stap; het aantal dagen mag er
 * op verschillende manieren achter staan ('· 2d', '- 2 dagen', '(2)') en
 * mag ook weg — dan is het één dag. Zo hoeft niemand een notatie te
 * leren om een stap toe te voegen.
 */
export function tekstNaarStappen(tekst: string): SjabloonStap[] {
  const uit: SjabloonStap[] = []
  for (const regel of tekst.split('\n')) {
    const schoon = regel.trim()
    if (!schoon) continue
    const match = schoon.match(/^(.*?)[\s·\-–(]*(\d+(?:[.,]\d+)?)\s*(?:d|dag|dagen)?\)?$/i)
    const naam = (match ? match[1] : schoon).replace(/[\s·\-–]+$/, '').trim()
    if (!naam) continue
    const getal = match ? Number(match[2].replace(',', '.')) : NaN
    // Minstens één werkdag: een stap van nul dagen staat wel op het bord
    // maar nergens in de tijd.
    const dagen = Number.isFinite(getal) && getal >= 1 ? Math.round(getal) : 1
    uit.push({ naam: naam.slice(0, 160), dagen: Math.min(dagen, 60) })
    if (uit.length >= MAX_STAPPEN) break
  }
  return uit
}

function isWeekend(datum: Date): boolean {
  const dag = datum.getDay()
  return dag === 0 || dag === 6
}

function naarIso(datum: Date): string {
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
}

/** De eerstvolgende werkdag op of vóór deze datum. */
function werkdagTerug(datum: Date): Date {
  const uit = new Date(datum)
  while (isWeekend(uit)) uit.setDate(uit.getDate() - 1)
  return uit
}

/** `aantal` werkdagen terug vanaf deze werkdag; 1 betekent dezelfde dag. */
function werkdagenTerug(eind: Date, aantal: number): Date {
  const uit = werkdagTerug(eind)
  let over = Math.max(1, aantal) - 1
  while (over > 0) {
    uit.setDate(uit.getDate() - 1)
    if (!isWeekend(uit)) over--
  }
  return uit
}

/**
 * De planning terugtellen vanaf de deadline.
 *
 * De laatste stap eindigt op de deadline (of op de werkdag ervoor als
 * die in het weekend valt), en elke stap ervoor eindigt op de werkdag
 * voordat de volgende begint. Zo kom je vanzelf uit op de datum waarop
 * je had moeten beginnen — ook als dat gisteren was. Liever een
 * startdatum die laat zien dat het krap is dan een planning die doet
 * alsof het past.
 */
export function planUitSjabloon(opties: {
  naam: string
  stappen: SjabloonStap[]
  /** jjjj-mm-dd: de dag waarop het af moet. */
  deadline: string
  ownerIds?: string[]
  urenPerDag?: number
}): { ok: true; plan: AiItemPlan } | { ok: false; error: string } {
  const naam = opties.naam.trim().slice(0, 160)
  if (!naam) return { ok: false, error: 'Geef de klus een naam.' }
  if (!DATUM.test(opties.deadline)) return { ok: false, error: 'Kies een datum waarop het af moet.' }
  const deadline = new Date(`${opties.deadline}T00:00:00`)
  if (Number.isNaN(deadline.getTime())) return { ok: false, error: 'Die datum begrijp ik niet.' }
  const stappen = opties.stappen.filter(stap => stap.naam.trim()).slice(0, MAX_STAPPEN)
  if (stappen.length === 0) return { ok: false, error: 'Zet er minstens één stap in.' }

  const urenPerDag = opties.urenPerDag && opties.urenPerDag > 0 ? opties.urenPerDag : UREN_PER_DAG
  const ownerIds = [...new Set((opties.ownerIds ?? []).filter(id => id && id !== 'unassigned'))]

  const subitems: AiSubitemPlan[] = []
  let cursor = werkdagTerug(deadline)
  for (const stap of [...stappen].reverse()) {
    const dagen = Math.max(1, Math.round(stap.dagen))
    const eind = werkdagTerug(cursor)
    const start = werkdagenTerug(eind, dagen)
    subitems.unshift({
      name: stap.naam.trim().slice(0, 160),
      startDate: naarIso(start),
      endDate: naarIso(eind),
      estHours: Math.round(dagen * urenPerDag * 10) / 10,
      ownerIds,
    })
    // De vorige stap eindigt op de werkdag vóór deze begint.
    cursor = new Date(start)
    cursor.setDate(cursor.getDate() - 1)
    cursor = werkdagTerug(cursor)
  }

  const estHours = Math.round(subitems.reduce((som, sub) => som + sub.estHours, 0) * 10) / 10
  return {
    ok: true,
    plan: {
      name: naam,
      groupName: null,
      startDate: subitems[0].startDate,
      endDate: subitems[subitems.length - 1].endDate,
      estHours,
      ownerIds,
      notes: null,
      subitems,
    },
  }
}

// ── De planning met de muis bijstellen ───────────────────────────────
//
// In het voorstel kun je elke stap verslepen of aan de randen uitrekken.
// Dat rekenwerk staat hier, zodat het te lezen en te testen is zonder
// scherm. Twee regels gelden overal: een stap begint en eindigt op een
// werkdag, en hij is minstens één dag lang.

function parse(iso: string): Date | null {
  if (!DATUM.test(iso)) return null
  const datum = new Date(`${iso}T00:00:00`)
  return Number.isNaN(datum.getTime()) ? null : datum
}

function plusDagen(datum: Date, dagen: number): Date {
  const uit = new Date(datum)
  uit.setDate(uit.getDate() + dagen)
  return uit
}

/** De eerstvolgende werkdag vanaf deze datum, vooruit. */
function werkdagVooruit(datum: Date): Date {
  const uit = new Date(datum)
  while (isWeekend(uit)) uit.setDate(uit.getDate() + 1)
  return uit
}

/** Hoeveel werkdagen beslaat deze periode? */
export function werkdagenIn(startIso: string, eindIso: string): number {
  const start = parse(startIso)
  const eind = parse(eindIso)
  if (!start || !eind || eind < start) return 0
  let aantal = 0
  for (const dag = new Date(start); dag <= eind; dag.setDate(dag.getDate() + 1)) {
    if (!isWeekend(dag)) aantal++
  }
  return aantal
}

/** `aantal` werkdagen vooruit vanaf deze werkdag; 1 betekent dezelfde dag. */
function werkdagenVooruit(start: Date, aantal: number): Date {
  const uit = werkdagVooruit(start)
  let over = Math.max(1, aantal) - 1
  while (over > 0) {
    uit.setDate(uit.getDate() + 1)
    if (!isWeekend(uit)) over--
  }
  return uit
}

/** De hele stap opschuiven. Het aantal wérkdagen blijft gelijk: sleep je
 *  een klus van twee dagen naar vrijdag, dan loopt hij door tot maandag
 *  in plaats van het weekend in. */
export function verplaatsStap(startIso: string, eindIso: string, dagen: number):
  { startDate: string; endDate: string } {
  const start = parse(startIso)
  const eind = parse(eindIso)
  if (!start || !eind) return { startDate: startIso, endDate: eindIso }
  const lengte = Math.max(1, werkdagenIn(startIso, eindIso))
  const nieuweStart = werkdagVooruit(plusDagen(start, dagen))
  return {
    startDate: naarIso(nieuweStart),
    endDate: naarIso(werkdagenVooruit(nieuweStart, lengte)),
  }
}

/** Eén kant van de stap verslepen. De andere kant blijft staan, en de
 *  stap blijft minstens één werkdag lang. */
export function rekStap(startIso: string, eindIso: string, kant: 'start' | 'eind', dagen: number):
  { startDate: string; endDate: string } {
  const start = parse(startIso)
  const eind = parse(eindIso)
  if (!start || !eind) return { startDate: startIso, endDate: eindIso }
  if (kant === 'start') {
    let nieuw = werkdagVooruit(plusDagen(start, dagen))
    if (nieuw > eind) nieuw = werkdagTerug(eind)
    return { startDate: naarIso(nieuw), endDate: naarIso(werkdagTerug(eind)) }
  }
  let nieuw = werkdagTerug(plusDagen(eind, dagen))
  if (nieuw < start) nieuw = werkdagVooruit(start)
  return { startDate: naarIso(werkdagVooruit(start)), endDate: naarIso(nieuw) }
}
