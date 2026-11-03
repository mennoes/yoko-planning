import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
function load(file, dependencies = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: name => dependencies[name] })
  return exports
}
const { mergeDetailPatch } = load('boardItemPatch', { './ownerHours': load('ownerHours') })
test('Home and agenda patches preserve Google override flags', () => {
  const result = mergeDetailPatch({ id: 'event', source: 'google', status: '', notes: 'keep' }, { status: 'Done', startDate: '2026-11-04', estHours: 3 })
  assert.equal(result.statusOverride, 'done')
  assert.equal(result.datesOverride, true)
  assert.equal(result.hoursOverride, true)
  assert.equal(result.notes, 'keep')
})
test('editing total hours rescales owner shares and clearing hours clears shares', () => {
  const item = { estHours: 8, ownerHours: { a: 6, b: 2 } }
  assert.deepEqual({ ...mergeDetailPatch(item, { estHours: 4 }).ownerHours }, { a: 3, b: 1 })
  assert.equal(mergeDetailPatch(item, { estHours: 0 }).ownerHours, undefined)
})
test('editing a subitem preserves its identity, deadline and unrelated fields', () => {
  const item = { id: 'stable-sub', name: 'Meeting', deadline: '2026-11-05', estHours: 1, ownerIds: ['a', 'b'], ownerHours: { a: .5, b: .5 }, googlePlacementLocked: true }
  const result = mergeDetailPatch(item, { ownerIds: ['a'] })
  assert.equal(result.id, 'stable-sub')
  assert.equal(result.deadline, '2026-11-05')
  assert.equal(result.googlePlacementLocked, true)
  assert.deepEqual({ ...result.ownerHours }, { a: .5 })
  assert.deepEqual(item.ownerIds, ['a', 'b'])
})
