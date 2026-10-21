import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/datumInvoer.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
runInNewContext(js, { exports, Date, Number, String, RegExp })
const { naarNl, naarIso } = exports

const VANDAAG = new Date(2026, 9, 21) // 21 oktober 2026

test('een ISO-datum wordt dag-maand-jaar', () => {
  assert.equal(naarNl('2026-11-04'), '04-11-2026')
  assert.equal(naarNl('2026-11-04T10:00:00Z'), '04-11-2026')
})

test('niets blijft niets', () => {
  assert.equal(naarNl(null), '')
  assert.equal(naarNl(''), '')
  assert.equal(naarNl('onzin'), '')
})

test('dag-maand-jaar lezen, met elk scheidingsteken', () => {
  for (const invoer of ['04-11-2026', '4-11-2026', '04/11/2026', '4.11.2026', '4 11 2026']) {
    assert.equal(naarIso(invoer, VANDAAG), '2026-11-04', invoer)
  }
})

test('het jaartal mag weg — dan dit jaar', () => {
  assert.equal(naarIso('4-11', VANDAAG), '2026-11-04')
  assert.equal(naarIso('31/12', VANDAAG), '2026-12-31')
})

test('een tweecijferig jaartal telt als deze eeuw', () => {
  assert.equal(naarIso('4-11-27', VANDAAG), '2027-11-04')
})

test('zonder scheidingstekens tikken mag ook', () => {
  assert.equal(naarIso('0411', VANDAAG), '2026-11-04', 'ddmm')
  assert.equal(naarIso('041127', VANDAAG), '2027-11-04', 'ddmmjj')
  assert.equal(naarIso('04112026', VANDAAG), '2026-11-04', 'ddmmjjjj')
})

test('de dag staat voorop, niet de maand', () => {
  // Dit is de hele reden voor dit veld: 11/04 is 11 april, geen 4 november.
  assert.equal(naarIso('11/04/2026', VANDAAG), '2026-04-11')
})

test('een datum die niet bestaat komt er niet uit', () => {
  assert.equal(naarIso('31-02-2026', VANDAAG), null, '31 februari bestaat niet')
  assert.equal(naarIso('32-01-2026', VANDAAG), null)
  assert.equal(naarIso('04-13-2026', VANDAAG), null, 'maand 13')
  assert.equal(naarIso('0-11-2026', VANDAAG), null)
})

test('29 februari mag in een schrikkeljaar en anders niet', () => {
  assert.equal(naarIso('29-02-2028', VANDAAG), '2028-02-29')
  assert.equal(naarIso('29-02-2027', VANDAAG), null)
})

test('onzin levert null op, zodat het veld niet leeggegooid wordt', () => {
  assert.equal(naarIso('morgen', VANDAAG), null)
  assert.equal(naarIso('4', VANDAAG), null, 'alleen een dag is te weinig')
  assert.equal(naarIso('4-11-2026-3', VANDAAG), null)
})

test('leeg betekent leeg', () => {
  assert.equal(naarIso('', VANDAAG), null)
  assert.equal(naarIso('   ', VANDAAG), null)
})

test('heen en terug blijft dezelfde dag', () => {
  for (const isoDatum of ['2026-01-01', '2026-12-31', '2028-02-29']) {
    assert.equal(naarIso(naarNl(isoDatum), VANDAAG), isoDatum)
  }
})
