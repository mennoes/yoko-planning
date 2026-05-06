import pkg from 'xlsx'
const { readFile, utils } = pkg
import { writeFileSync } from 'fs'

const BOARD_MAP = {
  'yoko_1778072777.xlsx':        { key: 'yoko',       color: '#579bfc' },
  'Vlaanderen_1778072956.xlsx':  { key: 'vlaanderen', color: '#ff7a00' },
  'Dienjaar_1778072970.xlsx':    { key: 'dienjaar',   color: '#00c875' },
  'PnP_1778072930.xlsx':         { key: 'pnp',        color: '#e2445c' },
  'Nederland_1778072942.xlsx':   { key: 'nederland',  color: '#9c7ee8' },
}

const MEMBER_MAP = {
  'menno':          'menno',
  'vincent':        'vincent',
  'odette':         'odette',
  'odette slotboom':'odette',
  'kars':           'kars',
  'anne-fleur':     'anne-fleur',
  'anne fleur':     'anne-fleur',
  'anne-fleur zoodsma': 'anne-fleur',
}

function parseMemberIds(ownerStr) {
  if (!ownerStr) return []
  return String(ownerStr).split(/[,;/&]+/).map(s => {
    const norm = s.trim().toLowerCase()
    for (const [key, id] of Object.entries(MEMBER_MAP)) {
      if (norm.includes(key)) return id
    }
    return null
  }).filter(Boolean)
}

function excelDateToISO(v) {
  if (!v) return null
  if (typeof v === 'string' && v.includes('-')) return v.split('T')[0]
  if (typeof v === 'string' && v.includes('/')) {
    const parts = v.split('/')
    if (parts.length === 3) {
      const [d, m, y] = parts
      return `${y.length === 2 ? '20'+y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
    }
  }
  if (typeof v === 'number') {
    // Excel serial date
    const date = utils.numberToDate ? utils.numberToDate(v) : new Date(Math.round((v - 25569) * 86400 * 1000))
    return date.toISOString().split('T')[0]
  }
  return null
}

function normalizeStatus(s) {
  if (!s) return ''
  const l = String(s).toLowerCase()
  if (l.includes('done') || l.includes('klaar') || l.includes('afgerond')) return 'Done'
  if (l.includes('working') || l.includes('bezig')) return 'Working on...'
  if (l.includes('stuck') || l.includes('vastge')) return 'Stuck'
  if (l.includes('not started') || l.includes('niet')) return 'Not started'
  return String(s)
}

let id = Date.now()
function nextId() { return String(id++) }

for (const [filename, { key, color }] of Object.entries(BOARD_MAP)) {
  const path = `C:/Users/menno/Downloads/${filename}`
  let wb
  try {
    wb = readFile(path)
  } catch (e) {
    console.error(`Could not read ${filename}:`, e.message)
    continue
  }

  const groups = []
  let currentGroup = null

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows  = utils.sheet_to_json(sheet, { header: 1, defval: '' })

    if (!rows.length) continue

    // Detect header row (find row with 'naam' / 'name' / 'item' / 'project')
    let headerIdx = 0
    let colMap    = {}
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i].map(c => String(c).toLowerCase().trim())
      const nameCol = row.findIndex(c => c === 'naam' || c === 'name' || c === 'item' || c === 'project' || c === 'titel' || c === 'title')
      if (nameCol !== -1) {
        headerIdx = i
        colMap.name      = nameCol
        colMap.owner     = row.findIndex(c => c.includes('eigen') || c.includes('owner') || c.includes('person') || c.includes('persoon') || c.includes('wie') || c === 'toewijzen')
        colMap.status    = row.findIndex(c => c.includes('status'))
        colMap.start     = row.findIndex(c => c.includes('start'))
        colMap.end       = row.findIndex(c => c.includes('end') || c.includes('eind') || c.includes('deadline') || c.includes('lever'))
        colMap.deadline  = row.findIndex(c => c === 'deadline')
        colMap.hours     = row.findIndex(c => c.includes('uur') || c.includes('hour') || c.includes('tijd') || c.includes('estim') || c.includes('geschat'))
        colMap.group     = row.findIndex(c => c.includes('groep') || c.includes('group') || c.includes('fase') || c.includes('categor'))
        break
      }
    }

    // Use sheet name as group if no group column
    currentGroup = { id: nextId(), name: sheetName, color, collapsed: false, items: [] }
    groups.push(currentGroup)

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row  = rows[r]
      const name = String(row[colMap.name] ?? '').trim()
      if (!name) continue

      // Check if this row is a group header (bold / all-caps / single merged cell)
      const nonEmpty = row.filter(c => String(c).trim()).length
      if (nonEmpty === 1 && colMap.name !== undefined) {
        // Likely a section header row
        currentGroup = { id: nextId(), name, color, collapsed: false, items: [] }
        groups.push(currentGroup)
        continue
      }

      const ownerRaw  = colMap.owner  !== -1 ? row[colMap.owner]  : ''
      const ownerIds  = parseMemberIds(ownerRaw)
      const startRaw  = colMap.start  !== -1 ? row[colMap.start]  : null
      const endRaw    = colMap.end    !== -1 ? row[colMap.end]    : null
      const dlRaw     = colMap.deadline !== -1 ? row[colMap.deadline] : null
      const statusRaw = colMap.status !== -1 ? row[colMap.status] : ''
      const hoursRaw  = colMap.hours  !== -1 ? row[colMap.hours]  : 0

      currentGroup.items.push({
        id:        nextId(),
        name,
        ownerIds,
        status:    normalizeStatus(statusRaw),
        startDate: excelDateToISO(startRaw),
        endDate:   excelDateToISO(endRaw),
        deadline:  excelDateToISO(dlRaw),
        estHours:  parseFloat(String(hoursRaw)) || 0,
        dagen:     0,
      })
    }
  }

  // Remove empty groups
  const filtered = groups.filter(g => g.items.length > 0)

  const outPath = `D:/Dropbox/studio yoko/Website/Planning tool/yoko-planner/data/boards/${key}.json`
  writeFileSync(outPath, JSON.stringify({ groups: filtered }, null, 2), 'utf8')
  console.log(`✓ ${key}: ${filtered.length} groepen, ${filtered.reduce((s,g) => s + g.items.length, 0)} items`)
}

console.log('Done!')
