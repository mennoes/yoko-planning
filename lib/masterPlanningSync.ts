export const MASTER_PLANNING_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GdOFB393stbzPbmeHGX1ufe0I8BeXrB42fdW_KOxJK0/edit'
export const MASTER_PLANNING_CSV_URL = 'https://docs.google.com/spreadsheets/d/1GdOFB393stbzPbmeHGX1ufe0I8BeXrB42fdW_KOxJK0/gviz/tq?tqx=out:csv&gid=986156570'

export type MasterPlanningEpisode = {
  key: string
  kind: 'uvnl' | 'heyu'
  episode: number
  name: string
  topic: string | null
  contactpersoon: string | null
  startDate: string | null
  endDate: string | null
  deadline: string | null
  estHours: number
}

/** Google gviz returns RFC-4180-ish CSV, including quoted line breaks in
 * cells. Keep the parser local so the server route needs no spreadsheet
 * runtime dependency. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"'
        index++
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') { row.push(value); value = '' }
    else if (char === '\n') { row.push(value); rows.push(row); row = []; value = '' }
    else if (char !== '\r') value += char
  }
  if (value || row.length > 0) { row.push(value); rows.push(row) }
  return rows
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

function sheetDates(rows: string[][], seasonStartYear: number): Map<number, string> {
  const result = new Map<number, string>()
  let year = seasonStartYear
  let previousMonth: number | null = null
  for (let rowIndex = 3; rowIndex < rows.length; rowIndex++) {
    const match = (rows[rowIndex]?.[0] ?? '').trim().match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})-([A-Z][a-z]{2})$/)
    if (!match) continue
    const month = MONTHS[match[2]]
    if (month === undefined) continue
    if (previousMonth !== null && month < previousMonth) year++
    previousMonth = month
    result.set(rowIndex, `${year}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`)
  }
  return result
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeEditor(raw: string): string | null {
  const value = cleanWhitespace(raw)
  if (!value || /^TBD/i.test(value)) return null
  const fallback = value.match(/\+\s*([\p{L}-]+)/u)?.[1] ?? null
  if (/^FREELANCE\b/i.test(value)) return fallback
  const main = value.split('(')[0].trim()
  return main && !/^FREELANCE\b/i.test(main) ? main : fallback
}

function looksLikePersonName(value: string): boolean {
  const words = value.trim().split(/\s+/)
  if (words.length < 2) return false
  return words.every((word, index) =>
    /^(?:van|de|der|den|vd|ten)$/i.test(word) || (index === 0 || /^[A-ZÀ-Ý]/.test(word)))
}

export function normalizeTopic(raw: string, kind: MasterPlanningEpisode['kind']): string | null {
  let value = cleanWhitespace(raw)
  if (!value) return null
  if (kind === 'heyu') {
    value = value.replace(/^HEY\s*U\b\s*/i, '').trim()
    const onlyParentheses = value.match(/^\((.+)\)$/)
    if (onlyParentheses) value = onlyParentheses[1]
    else {
      const finalParentheses = value.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
      if (finalParentheses) {
        value = looksLikePersonName(finalParentheses[1]) ? finalParentheses[2] : finalParentheses[1]
      }
    }
  }
  value = value.replace(/[?!]+$/g, '').trim()
  return value ? value.charAt(0).toLocaleUpperCase('nl') + value.slice(1) : null
}

export function masterPlanningKey(kind: MasterPlanningEpisode['kind'], episode: number): string {
  return `${kind === 'heyu' ? 'heyu-s02' : 'uvnl-s05'}-e${String(episode).padStart(2, '0')}`
}

export function episodeKeyFromItemName(name: string): string | null {
  const uvnl = name.match(/^UvNL\s+S05\s+E(\d{1,2})\b/i)
  if (uvnl) return masterPlanningKey('uvnl', Number(uvnl[1]))
  const heyu = name.match(/^HEY\s*U\s+S02\s+E(\d{1,2})\b/i)
  if (heyu) return masterPlanningKey('heyu', Number(heyu[1]))
  return null
}

export function canonicalTopic(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl').replace(/[^a-z0-9]+/g, '')
}

export function topicFromItemName(name: string): string {
  return name.match(/\((.*)\)\s*$/)?.[1]?.trim() ?? ''
}

export function parseMasterPlanningCsv(csv: string, seasonStartYear = 2026): MasterPlanningEpisode[] {
  const rows = parseCsv(csv)
  if (rows.length < 7) throw new Error('De masterplanning bevat te weinig rijen.')
  const tokens = rows[0] ?? []
  const topics = rows[1] ?? []
  const editors = rows[2] ?? []
  const dates = sheetDates(rows, seasonStartYear)
  const episodes: MasterPlanningEpisode[] = []

  for (let column = 1; column < tokens.length; column++) {
    const token = cleanWhitespace(tokens[column] ?? '')
    const match = token.match(/^(HU)?(\d+)$/i)
    if (!match) continue // NWA en overige producties horen niet in Yoko.
    const kind: MasterPlanningEpisode['kind'] = match[1] ? 'heyu' : 'uvnl'
    const episode = Number(match[2])
    const animationDates: string[] = []
    const deadlineDates: string[] = []

    for (const [rowIndex, date] of dates) {
      const cell = rows[rowIndex]?.[column] ?? ''
      if (/ANIMEREN/i.test(cell) && !/ANIMEREN\s*\?/i.test(cell)) animationDates.push(date)
      if (/video\s+naar\s+AD/i.test(cell)) deadlineDates.push(date)
    }

    const topic = normalizeTopic(topics[column] ?? '', kind)
    const label = topic ?? 'onderwerp volgt'
    episodes.push({
      key: masterPlanningKey(kind, episode),
      kind,
      episode,
      name: kind === 'heyu'
        ? `HEY U S02 E${String(episode).padStart(2, '0')} (${label})`
        : `UvNL S05 E${String(episode).padStart(2, '0')} (${label})`,
      topic,
      contactpersoon: normalizeEditor(editors[column] ?? ''),
      startDate: animationDates[0] ?? null,
      endDate: animationDates.at(-1) ?? null,
      deadline: deadlineDates.at(-1) ?? null,
      estHours: kind === 'heyu' ? 16 : 24,
    })
  }
  return episodes
}

export function todayInAmsterdam(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}
