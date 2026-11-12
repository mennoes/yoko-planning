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

const groupMove = load('groupMove')
const { autoMoveDoneItems } = load('doneAutoMove', { './groupMove': groupMove })

test('moving a Google meeting to Done persists both placement and status', () => {
  const moved = groupMove.prepareItemForGroupMove({ id: 'meet-1', name: 'Google Meet', source: 'google', status: '' }, 'Done')
  assert.equal(moved.status, 'Done')
  assert.equal(moved.statusOverride, 'done')
  assert.equal(moved.googlePlacementLocked, true)
})

test('manual Google meeting placement remains in the Done group', () => {
  const moved = groupMove.prepareItemForGroupMove({ id: 'meet-1', name: 'Google Meet', source: 'google', status: '' }, 'Done')
  const result = autoMoveDoneItems([
    { id: 'meetings', name: 'Meetings', items: [] },
    { id: 'done', name: 'Done', items: [moved] },
  ])
  assert.equal(result[1].items[0].id, 'meet-1')
  assert.equal(result[0].items.length, 0)
})

test('legacy unlocked Google meetings are still repaired to Meetings', () => {
  const result = autoMoveDoneItems([
    { id: 'meetings', name: 'Meetings', items: [] },
    { id: 'done', name: 'Done', items: [{ id: 'meet-1', name: 'Google Meet', source: 'google', status: 'Done' }] },
  ])
  assert.equal(result[0].items[0].id, 'meet-1')
  assert.equal(result[1].items.length, 0)
})
