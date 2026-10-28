// Een mail uitpluizen tot stappen.
//
// Je plakt een mail van een klant en hier komt uit wat er bruikbaar in
// staat: waar het over gaat, wanneer het af moet, en de punten die als
// lijstje in de mail stonden. Geen model, geen netwerk — het leest
// opsommingen en datums, meer niet.
//
// Daarom is het bewust karig: staat er geen lijstje in, dan geeft dit
// geen stappen terug in plaats van een verzonnen planning. Wat er wél
// uit komt is een beginpunt dat je in het venster bijwerkt.

import type { SjabloonStap } from './sjabloonPlan'

export type UitMail = {
  /** Het onderwerp, of de eerste zinnige regel. */
  naam: string | null
  /** jjjj-mm-dd, als er een datum in staat. */
  deadline: string | null
  stappen: SjabloonStap[]
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
    let naam = regel.replace(BULLET, '').trim()
    if (!naam || isBeleefdheid(naam)) continue
    let dagen = 1
    const metDagen = naam.match(/[([]?\s*(\d{1,2}(?:[.,]5)?)\s*(?:werk)?dag(?:en)?\s*[)\]]?\s*$/i)
    if (metDagen) {
      const getal = Number(metDagen[1].replace(',', '.'))
      if (Number.isFinite(getal) && getal >= 1) dagen = Math.round(getal)
      naam = naam.slice(0, metDagen.index).trim()
    }
    // Een afsluitend leesteken hoort niet in de naam van een subitem.
    naam = naam.replace(/[\s:;,.·\-–]+$/, '').trim()
    if (!naam) continue
    uit.push({ naam: naam.slice(0, 160), dagen: Math.min(dagen, 60) })
  }
  return uit
}

export function mailNaarStappen(tekst: string, vandaag = new Date()): UitMail {
  return {
    naam: naamUitMail(tekst),
    deadline: deadlineUitMail(tekst, vandaag),
    stappen: stappenUitMail(tekst),
  }
}
