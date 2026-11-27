import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/homeWorkWeek.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const exports = {}
runInNewContext(js, { exports })

test('Friday off closes the workweek Thursday at 18:00', () => {
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-26T17:59:00'), [5]), false)
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-26T18:00:00'), [5]), true)
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-27T09:00:00'), [5]), true)
})

test('Thursday evening is not the end when Friday is a workday', () => {
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-26T20:00:00'), []), false)
})

test('weekend closes a regular Monday to Friday workweek', () => {
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-28T09:00:00'), []), true)
})

test('a day off midweek does not end the workweek early', () => {
  assert.equal(exports.isWorkWeekFinished(new Date('2026-11-25T20:00:00'), [3]), false)
})
