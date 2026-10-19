import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function laad(file, mocks = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Math, String, Number, Array, require(id) {
    if (id in mocks) return mocks[id]
    throw new Error(`Onverwachte afhankelijkheid ${id}`)
  } })
  return exports
}

const cols = laad('../lib/timelineCols.ts', {
  './workload': {
    getWeeks: () => [],
    getWeekLabel: () => ({ weekNum: 'W1', range: '1 – 7', isCurrentWeek: false }),
  },
})

/** Drie kolommen van elk een week breed, 100px per kolom. */
function weekRaster() {
  const maak = (vanIso, totIso) => ({
    key: vanIso, rangeStart: new Date(`${vanIso}T00:00:00`), rangeEnd: new Date(`${totIso}T23:59:59.999`),
    label1: '', label2: '', widthPx: 100, isCurrent: false, isPast: false,
  })
  return [
    maak('2026-10-05', '2026-10-11'),
    maak('2026-10-12', '2026-10-18'),
    maak('2026-10-19', '2026-10-25'),
  ]
}

test('het begin van het raster is 0 pixels', () => {
  assert.equal(Math.round(cols.dateToPx(weekRaster(), new Date('2026-10-05T00:00:00'))), 0)
})

test('halverwege de tweede kolom is halverwege die kolom', () => {
  // 15 okt is de vierde dag van een week die op 12 okt begint.
  const px = cols.dateToPx(weekRaster(), new Date('2026-10-15T12:00:00'))
  assert.ok(px > 100 && px < 200, `verwacht binnen de tweede kolom, kreeg ${px}`)
})

test('een datum voorbij het raster geeft null', () => {
  assert.equal(cols.dateToPx(weekRaster(), new Date('2027-01-01T00:00:00')), null)
})

test('een balk krijgt de breedte van zijn periode', () => {
  const balk = cols.rangeToPx(weekRaster(), new Date('2026-10-05T00:00:00'), new Date('2026-10-11T23:59:59'))
  assert.equal(Math.round(balk.left), 0)
  assert.equal(Math.round(balk.width), 100, 'één hele week is één kolom breed')
})

test('een balk die vóór het raster begint wordt links afgekapt', () => {
  const balk = cols.rangeToPx(weekRaster(), new Date('2026-09-01T00:00:00'), new Date('2026-10-11T23:59:59'))
  assert.equal(balk.left, 0)
  assert.ok(balk.width > 0)
})

test('een balk die na het raster doorloopt wordt rechts afgekapt', () => {
  const balk = cols.rangeToPx(weekRaster(), new Date('2026-10-19T00:00:00'), new Date('2027-03-01T00:00:00'))
  assert.equal(Math.round(balk.left + balk.width), 300, 'kapt af op de rechterrand van het raster')
})

test('een periode volledig buiten beeld geeft null, geen streepje van niks', () => {
  assert.equal(cols.rangeToPx(weekRaster(), new Date('2026-01-01'), new Date('2026-01-05')), null)
  assert.equal(cols.rangeToPx(weekRaster(), new Date('2027-01-01'), new Date('2027-01-05')), null)
})

test('een klus van één dag blijft zichtbaar', () => {
  // Zonder ondergrens is één dag in maandzoom minder dan een pixel breed.
  const balk = cols.rangeToPx(weekRaster(), new Date('2026-10-14T00:00:00'), new Date('2026-10-14T23:59:59'))
  assert.ok(balk.width >= 4, `verwacht minstens 4px, kreeg ${balk.width}`)
})

test('een einddatum vóór de startdatum levert geen negatieve balk op', () => {
  const balk = cols.rangeToPx(weekRaster(), new Date('2026-10-15T00:00:00'), new Date('2026-10-06T00:00:00'))
  assert.ok(balk.width > 0)
})

test('een x-positie komt terug als een datum in die kolom', () => {
  const raster = weekRaster()
  const px = cols.dateToPx(raster, new Date('2026-10-15T12:00:00'))
  const terug = cols.pxToDate(raster, px)
  assert.equal(cols.lokaleIso(terug), '2026-10-15', 'heen en terug levert dezelfde dag op')
})

test('slepen buiten het raster klemt op de randen', () => {
  const raster = weekRaster()
  assert.equal(cols.lokaleIso(cols.pxToDate(raster, -500)), '2026-10-05')
  assert.equal(cols.lokaleIso(cols.pxToDate(raster, 99999)), '2026-10-25')
})

test('een verschuiving in pixels wordt een heel aantal dagen', () => {
  const raster = weekRaster()
  // Eén kolom = 100px = 7 dagen.
  assert.equal(cols.pxNaarDagen(raster, 0, 100), 7)
  assert.equal(cols.pxNaarDagen(raster, 100, 0), -7)
  assert.equal(cols.pxNaarDagen(raster, 0, 0), 0, 'niet slepen is nul dagen')
})

test('lokaleIso schuift niet naar de vorige dag', () => {
  // toISOString() doet dat wel in NL (UTC+1/+2); dan landt een balk een
  // dag te vroeg.
  assert.equal(cols.lokaleIso(new Date(2026, 9, 19, 0, 30)), '2026-10-19')
  assert.equal(cols.lokaleIso(new Date(2026, 9, 19, 23, 30)), '2026-10-19')
})
