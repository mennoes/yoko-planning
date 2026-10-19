import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

/** De component zelf draait hier niet; we halen alleen de pure functies
 *  eruit. De imports worden weggemockt, want JSX en React hebben we niet
 *  nodig om te bepalen wélke regels er horen te staan. */
function laad(file, mocks = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  runInNewContext(js, {
    exports, Date, Math, String, Number, Array, Set, Boolean, JSON, isNaN,
    require(id) {
      if (id in mocks) return mocks[id]
      return new Proxy({}, { get: () => () => null })
    },
  })
  return exports
}

const tl = laad('../components/BoardTimeline.tsx')

const RASTER = new Date('2026-01-01T00:00:00')
const sub = (id, naam, van, tot, extra = {}) => ({
  id, name: naam, status: 'Working on it', ownerIds: ['menno'],
  startDate: van, endDate: tot, ...extra,
})
const periode = (van, tot) => ({ van: new Date(`${van}T00:00:00`), tot: new Date(`${tot}T23:59:59`) })

test('een item zonder subitems blijft één regel', () => {
  const regels = tl.bouwRegels(
    [{ item: { id: 'i1', name: 'Losse klus', ownerIds: ['menno'], subitems: [] }, periode: periode('2026-03-02', '2026-03-06') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.equal(regels.length, 1)
  assert.equal(regels[0].naam, 'Losse klus')
  assert.equal(regels[0].isOuder, false, 'zonder subitems is het geen samenvatting maar gewoon werk')
})

test('een item met subitems krijgt een regel per subitem, met de ouder erboven', () => {
  const item = {
    id: 'i1', name: 'Aflevering 9', ownerIds: ['menno'], subitems: [
      sub('s2', 'Montage', '2026-03-09', '2026-03-13'),
      sub('s1', 'Research', '2026-03-02', '2026-03-06'),
    ],
  }
  const regels = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-13') }],
    { toonAfgerond: false, rasterStart: RASTER })

  assert.deepEqual(Array.from(regels.map(r => r.naam)), ['Aflevering 9', 'Research', 'Montage'],
    'de ouder staat bovenaan, de subitems op volgorde van startdatum eronder')
  assert.equal(regels[0].isOuder, true, 'de ouder is een samenvatting')
  assert.equal(regels[1].isOuder, false)
  assert.equal(regels[1].subitemId, 's1', 'een subregel weet welk subitem het is')
  assert.equal(regels[1].itemId, 'i1', 'en bij welk item het hoort')
  assert.equal(regels[0].key !== regels[1].key, true, 'elke regel heeft een eigen sleutel')
})

test('de eigenaren van een subitem zijn die van het subitem zelf', () => {
  const item = {
    id: 'i1', name: 'Aflevering 9', ownerIds: ['menno'],
    subitems: [sub('s1', 'Montage', '2026-03-02', '2026-03-06', { ownerIds: ['eliane'] })],
  }
  const regels = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-06') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.deepEqual(Array.from(regels[0].ownerIds), ['menno'])
  assert.deepEqual(Array.from(regels[1].ownerIds), ['eliane'])
})

test('een subitem zonder ownerIds levert geen fout op', () => {
  // De data houdt zich niet altijd aan het type; een kapot subitem mag de
  // tijdlijn niet meenemen.
  const item = { id: 'i1', name: 'Aflevering 9', subitems: [{ id: 's1', name: 'Montage', startDate: '2026-03-02', endDate: '2026-03-06' }] }
  const regels = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-06') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.equal(regels.length, 2)
  assert.deepEqual(Array.from(regels[1].ownerIds), [])
})

test('afgeronde subitems staan er standaard niet bij, maar kunnen erbij', () => {
  const item = {
    id: 'i1', name: 'Aflevering 9', ownerIds: [], subitems: [
      sub('s1', 'Research', '2026-03-02', '2026-03-06', { status: 'Done' }),
      sub('s2', 'Montage', '2026-03-09', '2026-03-13'),
    ],
  }
  const uit = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-13') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.deepEqual(Array.from(uit.map(r => r.naam)), ['Aflevering 9', 'Montage'])

  const aan = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-13') }],
    { toonAfgerond: true, rasterStart: RASTER })
  assert.deepEqual(Array.from(aan.map(r => r.naam)), ['Aflevering 9', 'Research', 'Montage'])
  assert.equal(aan[1].isDone, true)
})

test('een subitem dat helemaal vóór het raster ligt krijgt geen regel', () => {
  // Anders staat er een rij zonder balk — precies de muur van lege rijen
  // waar het eerder op stukliep.
  const item = {
    id: 'i1', name: 'Aflevering 9', ownerIds: [], subitems: [
      sub('s1', 'Oud werk', '2025-02-01', '2025-02-05'),
      sub('s2', 'Montage', '2026-03-09', '2026-03-13'),
    ],
  }
  const regels = tl.bouwRegels([{ item, periode: periode('2026-03-09', '2026-03-13') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.deepEqual(Array.from(regels.map(r => r.naam)), ['Aflevering 9', 'Montage'])
})

test('een item waarvan alle subitems zonder datum zijn blijft één gewone regel', () => {
  const item = {
    id: 'i1', name: 'Aflevering 9', ownerIds: [],
    subitems: [{ id: 's1', name: 'Nog te plannen', status: '', ownerIds: [], startDate: null, endDate: null }],
  }
  const regels = tl.bouwRegels([{ item, periode: periode('2026-03-02', '2026-03-06') }],
    { toonAfgerond: false, rasterStart: RASTER })
  assert.equal(regels.length, 1)
  assert.equal(regels[0].isOuder, false, 'zonder subregels eronder is de ouder geen samenvatting')
})

test('subPeriode leest de datums van het subitem zelf', () => {
  const p = tl.subPeriode(sub('s1', 'Montage', '2026-03-09', '2026-03-13'))
  assert.equal(p.van.getFullYear(), 2026)
  assert.equal(p.van.getMonth(), 2)
  assert.equal(p.van.getDate(), 9)
  assert.equal(p.tot.getDate(), 13)
  assert.equal(tl.subPeriode({ id: 's', name: 'x', startDate: null, endDate: null }), null)
})
