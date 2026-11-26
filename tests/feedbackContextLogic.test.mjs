import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/feedbackContext.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
} }).outputText
const exports = {}
runInNewContext(js, { exports })

test('page and type are independently optional', () => {
  assert.equal(exports.feedbackContextPrefix('Planning', 'Vraag'), 'Op Planning pagina heb ik een vraag… ')
  assert.equal(exports.feedbackContextPrefix('Planning', null), 'Op Planning pagina… ')
  assert.equal(exports.feedbackContextPrefix(null, 'Wens'), 'Ik heb een wens… ')
  assert.equal(exports.feedbackContextPrefix(null, null), '')
})

test('custom types stay in the sentence and use the broad feedback category', () => {
  assert.equal(exports.feedbackKindFromLabel('Bug'), 'bug')
  assert.equal(exports.feedbackKindFromLabel('Ideeën'), 'idee')
  assert.equal(exports.feedbackKindFromLabel('Vraag'), 'feedback')
})
