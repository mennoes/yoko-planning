// Een mail uitpluizen tot stappen.
//
// Je plakt een mail van een klant en hier komt uit wat er bruikbaar in
// staat: waar het over gaat, wanneer het af moet, wie erbij genoemd
// worden, en de stappen. Geen model, geen netwerk — het leest tekst met
// regels die je kunt nalopen.
//
// Het kijkt op drie manieren naar stappen, in deze volgorde:
//   1. een lijstje met streepjes, bolletjes of nummers;
//   2. een zin met 'eerst … daarna … tot slot', of een opsomming op één
//      regel ('1) script 2) storyboard');
//   3. losse regels die met een werkwoord beginnen ('Script schrijven').
// Levert geen van drieën iets op, dan geeft dit geen stappen terug in
// plaats van een verzonnen planning. Herkent het wel waar de mail over
// gaat ('explainer', 'podcast'), dan noemt het dat sjabloon als
// beginpunt — als suggestie, niet als uitkomst.

import { SJABLONEN, type Sjabloon, type SjabloonStap } from './sjabloonPlan'

export type UitMail = {
  /** Het onderwerp, of de eerste zinnige regel. */
  naam: string | null
  /** jjjj-mm-dd, als er een datum in staat. */
  deadline: string | null
  stappen: SjabloonStap[]
  /** Waar die stappen vandaan komen: uit de mail zelf, of een sjabloon
   *  dat bij het onderwerp past. */
  bron: 'lijstje' | 'zinnen' | 'regels' | 'sjabloon' | 'geen'
  /** Namen uit de mail die ook teamlid zijn. */
  ownerNamen: string[]
  /** Het sjabloon dat bij deze mail lijkt te passen, als we er een
   *  herkennen. */
  sjabloonId: string | null
}

const MAANDEN: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, maart: 3, mrt: 3, maa: 3,
  april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  augustus: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}

/** Regels die wel in een mail staan maar nooit een stap zijn. */
const AANHEF = [
  /^(hoi|hallo|hey|beste|geachte|dag)\b/i,
  /^(van|aan|cc|bcc|datum|date|to|from)\s*:/i,
]
/** Vanaf hier is het ondertekening: de naam eronder is een afzender,
 *  geen onderwerp. */
const AFSLUITING = [
  /^(groet|groeten|groetjes|mvg|met vriendelijke groet|hartelijke groet|alvast bedankt|bedankt|dank)\b/i,
  /^(verstuurd (vanaf|van)|sent from|op .* schreef)\b/i,
]

const BULLET = /^\s*(?:[-*•▪·–—]|\d{1,2}[.)])\s+/

function schoon(regel: string): string {
  return regel.replace(/\s+/g, ' ').trim()
}

function isBeleefdheid(regel: string): boolean {
  return AANHEF.some(patroon => patroon.test(regel)) || AFSLUITING.some(patroon => patroon.test(regel))
}

function iso(jaar: number, maand: number, dag: number): string | null {
  const datum = new Date(jaar, maand - 1, dag)
  if (datum.getFullYear() !== jaar || datum.getMonth() !== maand - 1 || datum.getDate() !== dag) return null
  return `${jaar}-${String(maand).padStart(2, '0')}-${String(dag).padStart(2, '0')}`
}

/**
 * De datum uit een mail.
 *
 * Eerst kijken we bij woorden als 'uiterlijk' of 'deadline'; staat daar
 * niets, dan nemen we de laatste datum in de tekst — in een mail is dat
 * meestal de afspraak en niet de datum van het bericht zelf. Een datum
 * zonder jaar hoort bij het eerstvolgende moment dat nog komt.
 */
export function deadlineUitMail(tekst: string, vandaag = new Date()): string | null {
  const gevonden: Array<{ index: number; datum: string }> = []
  const vandaagIso = iso(vandaag.getFullYear(), vandaag.getMonth() + 1, vandaag.getDate())!

  // 12 december (2026) / 12 dec
  const metMaandnaam = /(\d{1,2})\s*(?:e|ste|de)?\s+([a-z]+)\.?(?:\s+(\d{4}))?/gi
  for (const match of tekst.matchAll(metMaandnaam)) {
    const maand = MAANDEN[match[2].toLowerCase()]
    if (!maand) continue
    const dag = Number(match[1])
    const jaar = match[3] ? Number(match[3]) : vandaag.getFullYear()
    let datum = iso(jaar, maand, dag)
    // Geen jaar erbij en de datum is al geweest? Dan bedoelt de mail
    // volgend jaar.
    if (datum && !match[3] && datum < vandaagIso) datum = iso(jaar + 1, maand, dag)
    if (datum) gevonden.push({ index: match.index ?? 0, datum })
  }

  // 12-12-2026 / 12/12/26 / 2026-12-12
  const metCijfers = /(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})/g
  for (const match of tekst.matchAll(metCijfers)) {
    const [, a, b, c] = match
    const datum = a.length === 4
      ? iso(Number(a), Number(b), Number(c))
      : iso(Number(c) < 100 ? 2000 + Number(c) : Number(c), Number(b), Number(a))
    if (datum) gevonden.push({ index: match.index ?? 0, datum })
  }

  if (gevonden.length === 0) return null

  // Staat er vlak vóór een datum een woord dat 'af op' betekent, dan is
  // dat de datum die we zoeken.
  const sleutels = /(uiterlijk|deadline|aanlever|opleve|af(?:ronden)? (?:op|voor)|klaar (?:op|voor)|live|publicatie|presentatie)/gi
  let beste: { afstand: number; datum: string } | null = null
  for (const sleutel of tekst.matchAll(sleutels)) {
    for (const datum of gevonden) {
      const afstand = datum.index - (sleutel.index ?? 0)
      if (afstand < 0 || afstand > 80) continue
      if (!beste || afstand < beste.afstand) beste = { afstand, datum: datum.datum }
    }
  }
  if (beste) return beste.datum
  return gevonden[gevonden.length - 1].datum
}

/** Het onderwerp van de mail, of de eerste regel die ergens over gaat. */
export function naamUitMail(tekst: string): string | null {
  const regels = tekst.split('\n').map(schoon).filter(Boolean)
  for (const regel of regels) {
    const onderwerp = regel.match(/^(?:onderwerp|subject|betreft)\s*:\s*(.+)$/i)
    if (onderwerp) return onderwerp[1].replace(/^(re|fwd?|aw)\s*:\s*/i, '').trim().slice(0, 160)
  }
  for (const regel of regels) {
    // Onder een afsluiting staat alleen nog een naam; daar is niets meer
    // te halen dat over de klus gaat.
    if (AFSLUITING.some(patroon => patroon.test(regel))) break
    if (isBeleefdheid(regel) || BULLET.test(regel)) continue
    if (regel.length > 90) continue
    return regel.slice(0, 160)
  }
  return null
}

/** Geschreven getallen, zoals ze in een mail staan. */
const GETALWOORD: Record<string, number> = {
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5,
  zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10,
}

/** Werkwoorden waarmee een regel een stap is en geen zin uit de mail.
 *  Bewust kort: liever een stap missen dan een beleefdheid planner. */
const WERKWOORD = new RegExp('^(' + [
  'script(en)?', 'schrijven', 'uitwerken', 'maken', 'ontwerpen', 'vormgeven',
  'animeren', 'monteren', 'opnemen', 'filmen', 'tekenen', 'storyboarden',
  'opleveren', 'aanleveren', 'presenteren', 'publiceren', 'plannen',
  'voorbereiden', 'verzamelen', 'inlezen', 'reviewen', 'nakijken', 'testen',
  'bouwen', 'opzetten', 'uitzoeken', 'briefen', 'casten', 'inspreken',
].join('|') + ')\\b', 'i')

/** Woorden die een sjabloon verraden. */
const SJABLOONWOORDEN: Array<{ id: string; woorden: RegExp }> = [
  { id: 'explainer', woorden: /\b(explainer|uitleg(video)?|animatievideo|whiteboard)\b/i },
  { id: 'podcast', woorden: /\b(podcast|aflevering|episode|opname|audio)\b/i },
  { id: 'campagne', woorden: /\b(campagne|socials?|advertentie|ads?|kanalen)\b/i },
  { id: 'ontwerp', woorden: /\b(ontwerp|huisstijl|logo|moodboard|vormgeving|design)\b/i },
]

/** Het aantal dagen achter een stap: '(2 dagen)', '3 werkdagen',
 *  'twee dagen', 'halve dag'. Geeft terug wat er stond én de naam zonder
 *  die toevoeging. */
function dagenUitNaam(naam: string): { naam: string; dagen: number } {
  const cijfers = naam.match(/[([]?\s*(\d{1,2}(?:[.,]5)?)\s*(?:werk)?dag(?:en)?\s*[)\]]?\s*$/i)
  if (cijfers) {
    const getal = Number(cijfers[1].replace(',', '.'))
    return {
      naam: naam.slice(0, cijfers.index).trim(),
      dagen: Number.isFinite(getal) && getal >= 1 ? Math.round(getal) : 1,
    }
  }
  const woorden = naam.match(/[([]?\s*(een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|halve)\s*(?:werk)?dag(?:en)?\s*[)\]]?\s*$/i)
  if (woorden) {
    const woord = woorden[1].toLowerCase()
    return {
      naam: naam.slice(0, woorden.index).trim(),
      // Een halve dag is in dit raster nog steeds één werkdag; de uren
      // pas je daarna aan.
      dagen: woord === 'halve' ? 1 : (GETALWOORD[woord] ?? 1),
    }
  }
  const weken = naam.match(/[([]?\s*(\d{1,2}|een|één|twee|drie|vier)\s*we(?:ek|ken)\s*[)\]]?\s*$/i)
  if (weken) {
    const ruw = weken[1].toLowerCase()
    const getal = GETALWOORD[ruw] ?? Number(ruw)
    return {
      naam: naam.slice(0, weken.index).trim(),
      dagen: Number.isFinite(getal) && getal >= 1 ? Math.min(60, Math.round(getal) * 5) : 5,
    }
  }
  return { naam, dagen: 1 }
}

function alsStap(ruweNaam: string): SjabloonStap | null {
  // Eerst de punt aan het eind weg: anders staat die tussen '(3 dagen)'
  // en het einde van de regel, en zien we het aantal dagen niet meer.
  const { naam, dagen } = dagenUitNaam(schoon(ruweNaam).replace(/[.!?]+$/, '').trim())
  const schoneNaam = naam
    // 'We beginnen met het script schrijven' → 'Het script schrijven'.
    .replace(/^(?:we|wij|je|jullie|ik)\s+(?:beginnen|begin|starten|start|gaan)\s+(?:met|aan)\s+(?:de\s+|het\s+)?/i, '')
    .replace(/^(en|ook|dan|daarna|vervolgens|tot slot|ten slotte|eerst)\b[\s,]*/i, '')
    .replace(/[\s:;,.·\-–]+$/, '').trim()
  if (!schoneNaam || schoneNaam.length < 2 || isBeleefdheid(schoneNaam)) return null
  // Een halve alinea is geen stap.
  if (schoneNaam.length > 90) return null
  return { naam: schoneNaam.slice(0, 160).charAt(0).toUpperCase() + schoneNaam.slice(1, 160), dagen: Math.min(dagen, 60) }
}

/**
 * De opsomming uit een mail als stappen.
 *
 * Alleen regels die als lijstje zijn opgeschreven: met een streepje, een
 * bolletje of een nummer ervoor. Staat er achter een punt hoeveel dagen
 * het kost ('montage (2 dagen)'), dan nemen we dat over; anders is het
 * één werkdag en pas je dat zelf aan.
 */
export function stappenUitMail(tekst: string): SjabloonStap[] {
  const uit: SjabloonStap[] = []
  for (const ruwe of tekst.split('\n')) {
    const regel = schoon(ruwe)
    if (!BULLET.test(regel)) continue
    const stap = alsStap(regel.replace(BULLET, ''))
    if (stap) uit.push(stap)
  }
  return uit
}

/**
 * Stappen uit lopende tekst.
 *
 * Twee vormen die klanten echt schrijven: 'eerst het script, dan
 * storyboard, daarna animeren' en een opsomming op één regel, '1)
 * script 2) storyboard'. Alleen stukken die met een werkwoord beginnen
 * of na zo'n volgorde-woord komen tellen mee — anders wordt elke
 * bijzin een subitem.
 */
export function stappenUitZinnen(tekst: string): SjabloonStap[] {
  const uit: SjabloonStap[] = []
  const zieEerst = /\b(eerst|daarna|vervolgens|dan|tot slot|ten slotte|als laatste|afsluitend)\b/i

  for (const ruweZin of tekst.split(/(?<=[.!?])\s+|\n/)) {
    const zin = schoon(ruweZin)
    if (!zin || isBeleefdheid(zin) || BULLET.test(zin)) continue

    // '1) script 2) storyboard 3) animeren' — ook zonder regeleindes.
    const genummerd = zin.split(/\s(?=\d{1,2}[.)]\s)/).filter(deel => /^\d{1,2}[.)]\s/.test(deel))
    if (genummerd.length >= 2) {
      for (const deel of genummerd) {
        const stap = alsStap(deel.replace(/^\d{1,2}[.)]\s*/, ''))
        if (stap) uit.push(stap)
      }
      continue
    }

    if (!zieEerst.test(zin)) continue
    // Knippen op komma's en volgorde-woorden; wat overblijft is per stuk
    // een stap, zolang er een werkwoord in staat.
    for (const deel of zin.split(/,|;| en (?=\w)|\b(?:daarna|vervolgens|tot slot|ten slotte|als laatste|afsluitend)\b/i)) {
      const kaal = schoon(deel).replace(/^(eerst|dan)\b[\s,]*/i, '')
      if (!kaal) continue
      const woorden = kaal.split(' ')
      const heeftWerkwoord = woorden.some(woord => WERKWOORD.test(woord))
      if (!heeftWerkwoord) continue
      const stap = alsStap(kaal)
      if (stap) uit.push(stap)
    }
  }
  return uit
}

/** Losse regels die met een werkwoord beginnen: 'Script schrijven',
 *  'Animatie maken'. Veel mails zetten hun lijstje zo neer, zonder
 *  streepjes ervoor. */
export function stappenUitRegels(tekst: string): SjabloonStap[] {
  const uit: SjabloonStap[] = []
  for (const ruwe of tekst.split('\n')) {
    const regel = schoon(ruwe)
    // Eerst stoppen bij de groet: daaronder staat alleen nog een
    // ondertekening. De beleefdheden-check hierna zou 'm overslaan in
    // plaats van te stoppen.
    if (AFSLUITING.some(patroon => patroon.test(regel))) break
    if (!regel || BULLET.test(regel) || isBeleefdheid(regel)) continue
    if (/[.!?]$/.test(regel) || regel.split(' ').length > 8) continue
    const woorden = regel.split(' ')
    if (!woorden.some(woord => WERKWOORD.test(woord))) continue
    const stap = alsStap(regel)
    if (stap) uit.push(stap)
  }
  return uit
}

/** Welk sjabloon past bij deze mail? */
export function sjabloonUitMail(tekst: string): Sjabloon | null {
  for (const kandidaat of SJABLOONWOORDEN) {
    if (!kandidaat.woorden.test(tekst)) continue
    const sjabloon = SJABLONEN.find(entry => entry.id === kandidaat.id)
    if (sjabloon) return sjabloon
  }
  return null
}

/** Teamleden die in de mail genoemd worden. Op voornaam, want zo
 *  schrijven mensen. */
export function ownersUitMail(tekst: string, leden: Array<{ name: string }>): string[] {
  const uit: string[] = []
  for (const lid of leden) {
    const voornaam = lid.name.split(' ')[0]
    if (!voornaam || voornaam.length < 3) continue
    const patroon = new RegExp(`\\b${voornaam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (patroon.test(tekst) && !uit.includes(lid.name)) uit.push(lid.name)
  }
  return uit
}

export function mailNaarStappen(
  tekst: string,
  opties: { vandaag?: Date; leden?: Array<{ name: string }> } = {},
): UitMail {
  const vandaag = opties.vandaag ?? new Date()
  const sjabloon = sjabloonUitMail(tekst)

  // In deze volgorde, want een lijstje dat er staat is altijd beter dan
  // iets wat wij eruit afleiden.
  const lijstje = stappenUitMail(tekst)
  const zinnen = lijstje.length > 0 ? [] : stappenUitZinnen(tekst)
  const regels = lijstje.length + zinnen.length > 0 ? [] : stappenUitRegels(tekst)
  const gevonden = lijstje.length > 0 ? lijstje : zinnen.length > 0 ? zinnen : regels

  const bron: UitMail['bron'] = lijstje.length > 0 ? 'lijstje'
    : zinnen.length > 0 ? 'zinnen'
    : regels.length > 0 ? 'regels'
    : sjabloon ? 'sjabloon'
    : 'geen'

  return {
    naam: naamUitMail(tekst),
    deadline: deadlineUitMail(tekst, vandaag),
    // Niets gevonden maar wel herkend waar het over gaat? Dan is het
    // sjabloon een beginpunt — met de melding erbij dat het een gok is.
    stappen: gevonden.length > 0 ? gevonden : (sjabloon ? [...sjabloon.stappen] : []),
    bron,
    ownerNamen: ownersUitMail(tekst, opties.leden ?? []),
    sjabloonId: sjabloon?.id ?? null,
  }
}
