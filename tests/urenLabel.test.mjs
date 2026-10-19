import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// urenLabel zet het totaal achter een ingeklapte kop ('Done (10) · 42u'),
// zodat je ziet hoeveel werk erin zit zonder 'm open te klappen.
const bron = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const begin = bron.indexOf('export function urenLabel')
const eind  = bron.indexOf('\n}', begin) + 2
const js = ts.transpileModule(bron.slice(begin, eind), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
runInNewContext(js, { exports, Math })
const { urenLabel } = exports

test('een totaal komt achter de kop te staan', () => {
  assert.equal(urenLabel(42), ' · 42u')
})

test('halve uren blijven leesbaar', () => {
  assert.equal(urenLabel(10.5), ' · 10.5u')
  assert.equal(urenLabel(10.449), ' · 10.4u', 'afronden op één decimaal')
})

test('nul uur levert niets op', () => {
  // Een kop met '· 0u' erachter is alleen ruis.
  assert.equal(urenLabel(0), '')
  assert.equal(urenLabel(0.04), '', 'afgerond nul telt ook als nul')
})

test('een negatief of onzinnig totaal wordt niet getoond', () => {
  assert.equal(urenLabel(-5), '')
})
