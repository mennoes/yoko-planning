const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const SRC_DIR = '/root/.claude/uploads/bc3e4828-e99c-4189-a2fc-220e6b0eb92b'
const FILES = {
  yoko:       'b80a7378-yoko_1778157459.xlsx',
  pnp:        '317a170d-PnP_1778157473.xlsx',
  nederland:  'ef0383c4-Nederland_1778157493.xlsx',
  vlaanderen: '65677c65-Vlaanderen_1778157507.xlsx',
  dienjaar:   'f78fb3c5-Dienjaar_1778157517.xlsx',
}

function excelSerialToIso(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

const PALETTE = ['#579bfc','#9c7ee8','#e2445c','#00c875','#ff7a00','#ffcb00','#a25ddc','#26b3a4','#ec6e8b','#9aadbd']
function makeColorCycler() { let i = 0; return () => PALETTE[i++ % PALETTE.length] }

// Map full names to existing short IDs in team.json
const NAME_TO_ID = {
  'menno':                'menno',
  'vincent':              'vincent',
  'odette slotboom':      'odette',
  'odette':               'odette',
  'kars':                 'kars',
  'anne-fleur zoodsma':   'anne-fleur',
  'anne-fleur':           'anne-fleur',
}
function memberId(name) {
  const k = name.toLowerCase().trim()
  if (NAME_TO_ID[k]) return NAME_TO_ID[k]
  return k.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const allMembers = new Map()  // id -> name
function rememberOwners(names) {
  for (const n of names) {
    const id = memberId(n); if (!id) continue
    if (!allMembers.has(id)) allMembers.set(id, n)
  }
}

function parseOwners(s) {
  if (!s) return []
  return String(s).split(/[,\/&]/).map(x => x.trim()).filter(Boolean)
}

function isHeaderRow(row, key) {
  return String(row[0] ?? '').trim() === 'Name' || String(row[0] ?? '').trim() === key
}

function indexOf(arr, ...names) {
  for (const n of names) {
    const i = arr.findIndex(c => String(c || '').toLowerCase().trim() === n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}
function buildTopHeader(arr) {
  return {
    name:     indexOf(arr, 'Name'),
    owner:    indexOf(arr, 'Owner', 'Persoon'),
    status:   indexOf(arr, 'Status'),
    start:    indexOf(arr, 'Timeline - Start', 'Tijdlijn - Start'),
    end:      indexOf(arr, 'Timeline - End', 'Tijdlijn - End'),
    deadline: indexOf(arr, 'Deadline'),
    hours:    indexOf(arr, 'Est Time', 'Uren'),
    contact:  indexOf(arr, 'Contactpersoon'),
    dagen:    indexOf(arr, 'Dagen'),
    notes:    indexOf(arr, 'Notes', 'Notities'),
    uitzend:  indexOf(arr, 'Uitzenddag', 'Datum'),
    framelink:indexOf(arr, 'Frame link', 'Files'),
    nummers:  indexOf(arr, 'Nummers'),
  }
}
function buildSubHeader(arr) {
  return {
    name:     indexOf(arr, 'Name'),
    owner:    indexOf(arr, 'Owner', 'Persoon'),
    status:   indexOf(arr, 'Status'),
    start:    indexOf(arr, 'Timeline - Start', 'Tijdlijn - Start'),
    end:      indexOf(arr, 'Timeline - End', 'Tijdlijn - End'),
    hours:    indexOf(arr, 'Est time', 'Est Time', 'Uren'),
    worked:   indexOf(arr, 'Echt gewerkt'),
  }
}

function parseBoard(boardKey, rows) {
  const groups = []
  const cycle = makeColorCycler()
  let curGroup = null
  let curItem  = null
  let mode = 'top'
  let topHeader = null
  let subHeader = null

  // Title rows to ignore (board name + tagline-style rows)
  const ignoredTitles = new Set([
    boardKey,
    'overall planning studio yoko',
  ])

  // First, ensure there's at least one default group.
  function ensureGroup(name) {
    if (curGroup && curGroup.name === name) return curGroup
    curGroup = { id: `g_${boardKey}_${groups.length}`, name, color: cycle(), items: [] }
    groups.push(curGroup)
    curItem = null
    return curGroup
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || []
    const nonEmpty = row.filter(c => c !== '' && c != null)
    if (nonEmpty.length === 0) continue

    const first    = String(row[0] ?? '').trim()
    const firstLow = first.toLowerCase()

    // Sub header
    if (first === 'Subitems') { subHeader = buildSubHeader(row); mode = 'sub'; continue }
    // Top header
    if (first === 'Name')     { topHeader = buildTopHeader(row); mode = 'top'; continue }

    // Possible group header: a 1-2 cell row with text and no obvious data fields
    if (nonEmpty.length <= 2 && first && !ignoredTitles.has(firstLow)) {
      ensureGroup(first)
      topHeader = null  // expect a column header to follow (for new sections)
      subHeader = null
      mode = 'top'
      continue
    }
    if (ignoredTitles.has(firstLow)) continue

    if (!curGroup) ensureGroup('Items')

    // Sub mode but row[0] has content → it's a new top-level item, switch back
    if (mode === 'sub' && first) {
      mode = 'top'
      // Keep the existing topHeader (the most recent one)
    }

    if (mode === 'sub' && subHeader && curItem) {
      const name = String(row[subHeader.name] ?? '').trim()
      if (!name) continue
      const owners = subHeader.owner >= 0 ? parseOwners(row[subHeader.owner]) : []
      rememberOwners(owners)
      curItem.subitems = curItem.subitems || []
      const sub = {
        id:        `si_${boardKey}_${groups.length}_${curItem.subitems.length}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        ownerIds:  owners.map(memberId),
        status:    subHeader.status >= 0 ? String(row[subHeader.status] ?? '') : '',
        startDate: subHeader.start  >= 0 ? excelSerialToIso(row[subHeader.start])  : null,
        endDate:   subHeader.end    >= 0 ? excelSerialToIso(row[subHeader.end])    : null,
        estHours:  subHeader.hours  >= 0 ? Number(row[subHeader.hours] ?? 0) || 0  : 0,
      }
      if (subHeader.worked >= 0 && row[subHeader.worked] !== undefined && row[subHeader.worked] !== '') {
        sub.echtGewerkt = Number(row[subHeader.worked]) || 0
      }
      curItem.subitems.push(sub)
      continue
    }

    // Top item row
    if (!topHeader) continue
    const name = String(row[topHeader.name] ?? '').trim()
    if (!name) continue
    const owners = topHeader.owner >= 0 ? parseOwners(row[topHeader.owner]) : []
    rememberOwners(owners)
    curItem = {
      id:        `it_${boardKey}_${groups.length}_${curGroup.items.length}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      ownerIds:  owners.map(memberId),
      status:    topHeader.status >= 0 ? String(row[topHeader.status] ?? '') : '',
      startDate: topHeader.start  >= 0 ? excelSerialToIso(row[topHeader.start])  : null,
      endDate:   topHeader.end    >= 0 ? excelSerialToIso(row[topHeader.end])    : null,
      deadline:  topHeader.deadline >= 0 ? excelSerialToIso(row[topHeader.deadline]) : null,
      estHours:  topHeader.hours  >= 0 ? Number(row[topHeader.hours] ?? 0) || 0 : 0,
      dagen:     topHeader.dagen  >= 0 ? Number(row[topHeader.dagen] ?? 0) || 0 : 0,
    }
    if (topHeader.contact >= 0 && row[topHeader.contact])     curItem.contactpersoon = String(row[topHeader.contact])
    if (topHeader.notes   >= 0 && row[topHeader.notes])       curItem.notes          = String(row[topHeader.notes])
    if (topHeader.uitzend >= 0 && row[topHeader.uitzend])     curItem.uitzenddag     = excelSerialToIso(row[topHeader.uitzend])
    if (topHeader.framelink >= 0 && row[topHeader.framelink]) curItem.framelink      = String(row[topHeader.framelink])
    if (topHeader.nummers >= 0 && row[topHeader.nummers] !== undefined && row[topHeader.nummers] !== '')
      curItem.nummers = Number(row[topHeader.nummers]) || 0
    curGroup.items.push(curItem)
  }

  return groups.filter(g => g.items.length > 0)
}

const out = {}
for (const [boardKey, file] of Object.entries(FILES)) {
  const wb = XLSX.readFile(path.join(SRC_DIR, file))
  const sheetName = wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true })
  out[boardKey] = parseBoard(boardKey, rows)
}

for (const [boardKey, groups] of Object.entries(out)) {
  const target = `/home/user/yoko-planning/data/boards/${boardKey}.json`
  fs.writeFileSync(target, JSON.stringify({ groups }, null, 2))
  const cnt = groups.reduce((s,g) => s + g.items.length, 0)
  const sub = groups.reduce((s,g) => s + g.items.reduce((t, i) => t + (i.subitems?.length ?? 0), 0), 0)
  console.log('Wrote', target, '— groups:', groups.length, 'items:', cnt, 'subitems:', sub)
}

console.log('\n=== Members detected ===')
for (const [id, name] of [...allMembers.entries()].sort((a,b) => a[1].localeCompare(b[1]))) {
  console.log(`  ${id}\t${name}`)
}
