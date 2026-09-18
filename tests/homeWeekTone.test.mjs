import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/homeWeekTone.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const exports = {}
runInNewContext(js, { exports, require(id) {
  if (id !== './workloadCategory') throw new Error(`Unexpected dependency ${id}`)
  return { isVrijTitle: name => /vakantie|vrij/i.test(name) }
} })

const contribution = (id, name, hours, group) => ({ hours, project: { id, name, group } })

test('a vacation week is not called a tough workweek', () => {
  const entries = [contribution('holiday', 'Vakantie', 40), contribution('work', 'Website', 5)]
  assert.equal(exports.homeWeekTone(entries, 40, 'past', {}),
    'vorige week had je 40u vrij en 5u werk gepland; samen 45u op je planning — check de overlap')
})

test('vacation alone is described as time off, not workload', () => {
  assert.equal(exports.homeWeekTone([contribution('holiday', 'Vakantie', 40)], 40, 'past', {}),
    'vorige week had je 40u vrij')
})

test('partial time off with work inside capacity is not called an overlap', () => {
  const entries = [contribution('holiday', 'Vrij', 16), contribution('work', 'Website', 20)]
  assert.equal(exports.homeWeekTone(entries, 40, 'next', {}),
    'volgende week heb je 16u vrij en 20u werk gepland')
})

test('a manual free category counts even with a neutral title', () => {
  assert.equal(exports.homeWeekTone([contribution('holiday', 'Zwitserland', 24)], 40, 'next', { holiday: 'vrij' }),
    'volgende week heb je 24u vrij')
})

test('ordinary work keeps its load description', () => {
  assert.equal(exports.homeWeekTone([contribution('work', 'Website', 45)], 40, 'past', {}),
    'vorige week was pittig (45u 💪)')
})
