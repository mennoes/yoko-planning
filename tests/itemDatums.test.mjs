import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function laad(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Math, String, Number, Array, Boolean })
  return exports
}

const { itemDatums, volgtSubitems } = laad('../lib/itemDatums.ts')

const sub = (van, tot, status = 'Working on it') => ({ status, startDate: van, endDate: tot })

test('zonder subitems gelden gewoon de eigen datums', () => {
  const d = itemDatums({ startDate: '2026-03-02', endDate: '2026-04-24', subitems: [] })
  assert.equal(d.startDate, '2026-03-02')
  assert.equal(d.endDate, '2026-04-24')
  assert.equal(d.bron, 'eigen')
})

test('een kort subitem kaapt de periode van het item niet', () => {
  // Dit is de klacht: je zet acht weken op de klus, er komt een subitem
  // van twee dagen bij, en opeens staat de hele klus op twee dagen.
  const d = itemDatums({
    startDate: '2026-03-02', endDate: '2026-04-24',
    subitems: [sub('2026-03-10', '2026-03-11')],
  })
  assert.equal(d.startDate, '2026-03-02', 'de eigen start blijft staan')
  assert.equal(d.endDate, '2026-04-24', 'en het eigen eind ook')
  assert.equal(d.bron, 'eigen')
})

test('ook een subitem dat buiten de eigen periode valt verandert niets', () => {
  const d = itemDatums({
    startDate: '2026-03-02', endDate: '2026-03-06',
    subitems: [sub('2026-05-01', '2026-05-30')],
  })
  assert.equal(d.startDate, '2026-03-02')
  assert.equal(d.endDate, '2026-03-06')
})

test('haal je de eigen periode weg, dan volgt hij de subitems', () => {
  const d = itemDatums({
    startDate: null, endDate: null,
    subitems: [sub('2026-03-10', '2026-03-11'), sub('2026-04-01', '2026-04-20')],
  })
  assert.equal(d.startDate, '2026-03-10', 'vroegste start van de subitems')
  assert.equal(d.endDate, '2026-04-20', 'laatste eind')
  assert.equal(d.bron, 'subitems')
})

test('afgeronde subitems rekken de periode niet op', () => {
  // Anders blijft een klus op 20 mei staan terwijl al het resterende werk
  // pas in juni begint.
  const d = itemDatums({
    startDate: null, endDate: null,
    subitems: [sub('2026-05-18', '2026-05-20', 'Done'), sub('2026-06-17', '2026-06-25')],
  })
  assert.equal(d.startDate, '2026-06-17')
  assert.equal(d.endDate, '2026-06-25')
})

test('zijn alle subitems af, dan tellen die alsnog mee', () => {
  // Een verlopen periode is bruikbaarder dan een lege.
  const d = itemDatums({
    startDate: null, endDate: null,
    subitems: [sub('2026-05-18', '2026-05-20', 'Done'), sub('2026-05-21', '2026-05-25', 'Done')],
  })
  assert.equal(d.startDate, '2026-05-18')
  assert.equal(d.endDate, '2026-05-25')
  assert.equal(d.bron, 'subitems')
})

test('alleen een startdatum levert een periode van één dag op', () => {
  const eigen = itemDatums({ startDate: '2026-03-02', endDate: null, subitems: [] })
  assert.equal(eigen.endDate, '2026-03-02')
  const alleenEind = itemDatums({ startDate: null, endDate: '2026-03-09', subitems: [] })
  assert.equal(alleenEind.startDate, '2026-03-09')
})

test('zonder datums, waar dan ook, komt er niets uit', () => {
  const d = itemDatums({ startDate: null, endDate: null, subitems: [sub(null, null)] })
  assert.equal(d.startDate, null)
  assert.equal(d.endDate, null)
  assert.equal(d.bron, 'geen')
})

test('volgtSubitems zegt of de cel nog automatisch is', () => {
  assert.equal(volgtSubitems({ startDate: null, endDate: null, subitems: [sub('2026-03-02', '2026-03-06')] }), true)
  assert.equal(volgtSubitems({ startDate: '2026-03-02', endDate: null, subitems: [sub('2026-03-02', '2026-03-06')] }), false)
  assert.equal(volgtSubitems({ startDate: null, endDate: null, subitems: [] }), false,
    'zonder subitems valt er niets te volgen')
})

test('een Google-serie volgt zijn instances, ook al staan er datums op', () => {
  // De klacht: bij bijna elk Google-item stond een ↺ alsof je de periode
  // zelf had ingevuld. De sync schrijft die datums; jij niet.
  const d = itemDatums({
    source: 'google',
    startDate: '2026-11-11', endDate: '2026-12-09',
    subitems: [sub('2026-10-14', '2026-10-14'), sub('2026-11-11', '2026-11-11'), sub('2026-12-09', '2026-12-09')],
  })
  assert.equal(d.bron, 'subitems', 'de datums komen van de instances, niet van jou')
  assert.equal(d.startDate, '2026-10-14')
  assert.equal(d.endDate, '2026-12-09')
})

test('een Google-serie die je zelf hebt overschreven houdt zijn periode', () => {
  const d = itemDatums({
    source: 'google', datesOverride: true,
    startDate: '2026-11-11', endDate: '2026-12-09',
    subitems: [sub('2026-10-14', '2026-10-14')],
  })
  assert.equal(d.bron, 'eigen')
  assert.equal(d.startDate, '2026-11-11')
})

test('een Google-afspraak zonder instances houdt gewoon zijn eigen datum', () => {
  // Terugvallen op de subitems kan hier niet; dan zou de afspraak uit de
  // tijdlijn verdwijnen.
  const d = itemDatums({ source: 'google', startDate: '2026-11-11', endDate: '2026-11-11', subitems: [] })
  assert.equal(d.startDate, '2026-11-11')
  assert.equal(d.endDate, '2026-11-11')
})

test('een gewoon item met eigen datums blijft eigen, ook zonder vlaggetje', () => {
  // Alleen Google-items krijgen hun datums van een sync. Zet jij ze op een
  // gewoon item, dan gelden ze — ook als het vlaggetje van vóór die regel
  // nog ontbreekt.
  const d = itemDatums({ startDate: '2026-03-02', endDate: '2026-04-24', subitems: [sub('2026-03-10', '2026-03-11')] })
  assert.equal(d.bron, 'eigen')
  assert.equal(d.endDate, '2026-04-24')
})

test('volgtSubitems ziet een Google-serie als automatisch', () => {
  assert.equal(volgtSubitems({
    source: 'google', startDate: '2026-11-11', endDate: '2026-12-09',
    subitems: [sub('2026-10-14', '2026-10-14')],
  }), true, 'geen eigen periode, dus geen ↺')
  assert.equal(volgtSubitems({
    source: 'google', datesOverride: true, startDate: '2026-11-11', endDate: '2026-12-09',
    subitems: [sub('2026-10-14', '2026-10-14')],
  }), false)
})
