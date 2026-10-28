// Een klus uitschrijven op basis van wat je typt.
//
// Je plakt een briefing of je vertelt in één alinea wat er moet gebeuren,
// en hier komt een voorstel uit: een item met subitems, datums, uren en
// eigenaren. Het model levert alleen het vóórstel — wegschrijven gebeurt
// pas als je in de app op Aanmaken klikt.
//
// Alles in dit bestand is rekenwerk zonder netwerk of browser: de route
// roept het aan om het antwoord van het model te controleren, en de
// tests kunnen het rechtstreeks draaien. Wat het model teruggeeft is
// gegeven, geen instructie: onbekende namen, rare datums en negatieve
// uren worden hier stilletjes rechtgezet of weggelaten.

import type { BoardItem, SubItem } from './boards'

export type AiSubitemPlan = {
  name: string
  startDate: string | null
  endDate: string | null
  estHours: number
  ownerIds: string[]
}

export type AiItemPlan = {
  name: string
  /** De groep waar het item in hoort, als het model er een noemde die bestaat. */
  groupName: string | null
  startDate: string | null
  endDate: string | null
  estHours: number
  ownerIds: string[]
  notes: string | null
  subitems: AiSubitemPlan[]
}

export type PlanContext = {
  /** Vandaag, als jjjj-mm-dd. Alles relatiefs ('volgende week') rekent hierop. */
  today: string
  boardName: string
  groupNames: string[]
  members: Array<{ id: string; name: string }>
}

/** Meer dan dit is geen planning meer maar een lijst; het model wordt er
 *  ook op gewezen. */
export const MAX_SUBITEMS = 25

const DATUM = /^\d{4}-\d{2}-\d{2}$/

/** De vorm waarin het model moet antwoorden. Als 'tool' meegegeven zodat
 *  er geen proza omheen komt dat we eerst moeten uitpakken. */
export const PLAN_TOOL = {
  name: 'maak_planning',
  description: 'Zet een opdracht om in één item met subitems, datums, uren en eigenaren.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Korte naam van de klus, zoals die op het bord komt te staan.' },
      groupName: { type: 'string', description: 'De groep op dit bord waar het item in hoort. Laat weg als je twijfelt.' },
      startDate: { type: 'string', description: 'Startdatum als jjjj-mm-dd.' },
      endDate: { type: 'string', description: 'Einddatum als jjjj-mm-dd.' },
      estHours: { type: 'number', description: 'Geschatte uren voor de hele klus. Laat weg als de subitems de uren dragen.' },
      ownerIds: { type: 'array', items: { type: 'string' }, description: 'Namen of ids van de mensen die eraan werken.' },
      notes: { type: 'string', description: 'Korte toelichting; alleen wat niet in de naam past.' },
      subitems: {
        type: 'array',
        description: 'De stappen van de klus, in volgorde.',
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' },
            startDate: { type: 'string', description: 'jjjj-mm-dd' },
            endDate: { type: 'string', description: 'jjjj-mm-dd' },
            estHours: { type: 'number' },
            ownerIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['name'],
        },
      },
    },
    required: ['name'],
  },
}

export function planSystemPrompt(context: PlanContext): string {
  const mensen = context.members.map(m => `${m.name} (${m.id})`).join(', ') || 'geen teamleden bekend'
  const groepen = context.groupNames.length > 0 ? context.groupNames.join(', ') : 'geen groepen'
  return [
    'Je bent de planner van Studio Yoko. Je zet een opdracht om in één item met subitems.',
    `Vandaag is ${context.today}. Reken datums als "volgende week" hier vanaf.`,
    `Het item komt op de agenda "${context.boardName}". Beschikbare groepen: ${groepen}.`,
    `Teamleden: ${mensen}.`,
    '',
    'Hou je aan deze regels:',
    '- Werkdagen zijn maandag tot en met vrijdag; plan niets in het weekend.',
    '- Een werkdag is 8 uur. Schat liever iets ruimer dan te krap.',
    `- Maximaal ${MAX_SUBITEMS} subitems, in de volgorde waarin ze gedaan worden.`,
    '- Subitems vallen binnen de periode van het item.',
    '- Zet alleen mensen op een klus die in de lijst hierboven staan. Weet je het niet, laat het leeg.',
    '- Verzin geen feiten: wat niet in de opdracht staat, laat je weg.',
    'Antwoord uitsluitend door de tool maak_planning aan te roepen.',
  ].join('\n')
}

function tekst(waarde: unknown, max: number): string {
  return typeof waarde === 'string' ? waarde.trim().slice(0, max) : ''
}

function datum(waarde: unknown): string | null {
  const value = tekst(waarde, 10)
  if (!DATUM.test(value)) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : value
}

function uren(waarde: unknown): number {
  const getal = typeof waarde === 'number' ? waarde : Number(waarde)
  if (!Number.isFinite(getal) || getal <= 0) return 0
  // Boven de 2000 uur is het geen schatting meer maar een typefout.
  return Math.round(Math.min(getal, 2000) * 10) / 10
}

/** Namen of ids van het model terugbrengen tot bestaande teamleden.
 *  Een naam die we niet kennen laten we vallen in plaats van te gokken. */
function eigenaren(waarde: unknown, context: PlanContext): string[] {
  if (!Array.isArray(waarde)) return []
  const opNaam = new Map<string, string>()
  for (const member of context.members) {
    opNaam.set(member.id.toLowerCase(), member.id)
    opNaam.set(member.name.toLowerCase(), member.id)
    // Alleen de voornaam is genoeg zolang die niet dubbel voorkomt.
    const voornaam = member.name.split(' ')[0]?.toLowerCase()
    if (voornaam && !opNaam.has(voornaam)) opNaam.set(voornaam, member.id)
  }
  const uit: string[] = []
  for (const entry of waarde) {
    const gevonden = opNaam.get(tekst(entry, 80).toLowerCase())
    if (gevonden && !uit.includes(gevonden)) uit.push(gevonden)
  }
  return uit
}

function periode(start: string | null, eind: string | null): { startDate: string | null; endDate: string | null } {
  if (start && eind && eind < start) return { startDate: start, endDate: start }
  // Eén datum ingevuld betekent: die ene dag.
  if (start && !eind) return { startDate: start, endDate: start }
  if (!start && eind) return { startDate: eind, endDate: eind }
  return { startDate: start, endDate: eind }
}

/**
 * Het antwoord van het model controleren en rechtzetten.
 *
 * Geeft nooit half werk terug: zonder bruikbare naam is het een fout, al
 * het andere wordt zo goed mogelijk ingevuld of leeggelaten.
 */
export function normalizePlan(raw: unknown, context: PlanContext):
  { ok: true; plan: AiItemPlan } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Geen voorstel ontvangen.' }
  const data = raw as Record<string, unknown>
  const name = tekst(data.name, 160)
  if (!name) return { ok: false, error: 'Het voorstel heeft geen naam.' }

  const subitems: AiSubitemPlan[] = (Array.isArray(data.subitems) ? data.subitems : [])
    .slice(0, MAX_SUBITEMS)
    .map(entry => {
      const sub = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const subNaam = tekst(sub.name, 160)
      if (!subNaam) return null
      const { startDate, endDate } = periode(datum(sub.startDate), datum(sub.endDate))
      return {
        name: subNaam,
        startDate, endDate,
        estHours: uren(sub.estHours),
        ownerIds: eigenaren(sub.ownerIds, context),
      }
    })
    .filter((sub): sub is AiSubitemPlan => sub !== null)

  let { startDate, endDate } = periode(datum(data.startDate), datum(data.endDate))
  // Geen periode op het item zelf? Dan is de periode wat de subitems
  // samen beslaan — zelfde regel als de rest van de app.
  const subDatums = subitems.flatMap(sub => [sub.startDate, sub.endDate]).filter((d): d is string => !!d)
  if (!startDate && subDatums.length > 0) startDate = subDatums.reduce((a, b) => (a < b ? a : b))
  if (!endDate && subDatums.length > 0) endDate = subDatums.reduce((a, b) => (a > b ? a : b))

  const eigenUren = uren(data.estHours)
  const somSubs = Math.round(subitems.reduce((som, sub) => som + sub.estHours, 0) * 10) / 10
  // Dragen de subitems de uren, dan telt die som; anders de schatting van
  // het item zelf. Twee getallen die niet kloppen is erger dan één.
  const estHours = somSubs > 0 ? somSubs : eigenUren

  const groepNaam = tekst(data.groupName, 120).toLowerCase()
  const groupName = context.groupNames.find(naam => naam.toLowerCase() === groepNaam) ?? null

  return {
    ok: true,
    plan: {
      name, groupName, startDate, endDate, estHours,
      ownerIds: eigenaren(data.ownerIds, context),
      notes: tekst(data.notes, 2000) || null,
      subitems,
    },
  }
}

/** Het voorstel omzetten naar een echt item voor het bord. `maakId` geeft
 *  per aanroep een nieuw id; de app gebruikt daar z'n eigen teller voor. */
export function planToBoardItem(plan: AiItemPlan, maakId: () => string): BoardItem {
  const subitems: SubItem[] = plan.subitems.map(sub => ({
    id: maakId(),
    name: sub.name,
    ownerIds: sub.ownerIds,
    status: '',
    startDate: sub.startDate,
    endDate: sub.endDate,
    estHours: sub.estHours,
  }))
  const eigenUren = subitems.length > 0 ? 0 : plan.estHours
  return {
    id: maakId(),
    name: plan.name,
    ownerIds: plan.ownerIds,
    status: '',
    startDate: plan.startDate,
    endDate: plan.endDate,
    deadline: null,
    estHours: eigenUren,
    dagen: Math.round((eigenUren / 8) * 10) / 10,
    ...(plan.notes ? { notes: plan.notes } : {}),
    ...(subitems.length > 0 ? { subitems } : {}),
  }
}
