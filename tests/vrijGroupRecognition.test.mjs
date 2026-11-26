import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/workloadCategory.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
} }).outputText
const exports = {}
runInNewContext(js, { exports, require(id) {
  if (id === './supabase') return { supabase: null }
  if (id === './sync') return { getCurrentUserId: () => null }
  throw new Error(`Unexpected dependency ${id}`)
} })

test('Vrijheid is alleen vrij wanneer de groep Vrij is', () => {
  assert.equal(exports.isVrijTitle('Vrijheid'), false)
  assert.equal(exports.isVrijItem({ name: 'Vrijheid', group: 'Projecten' }), false)
  assert.equal(exports.isVrijItem({ name: 'Vrijheid', group: 'Vrij' }), true)
})

test('duidelijke vakantiegroepen worden herkend zonder brede substring-match', () => {
  assert.equal(exports.isVrijGroup('Vrij / vakantie'), true)
  assert.equal(exports.isVrijGroup('Vrijwilligers'), false)
})
