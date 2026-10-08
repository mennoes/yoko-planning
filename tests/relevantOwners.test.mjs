import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/relevantOwners.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
runInNewContext(js, { exports, Date, Number, Set, Math })

const sub = (patch = {}) => ({
  id: Math.random().toString(), name: 'Meeting', ownerIds: ['menno'], status: '',
  startDate: '2026-10-10', endDate: '2026-10-10', estHours: 2, ...patch,
})

test('owner relevance is limited to active work in the next five weeks', () => {
  const item = {
    ownerIds: ['anne-fleur', 'manuel'],
    subitems: [
      sub({ ownerIds: ['menno'] }),
      sub({ ownerIds: ['anne-fleur'], startDate: '2026-12-20', endDate: '2026-12-20' }),
      sub({ ownerIds: ['odette'], status: 'Done' }),
    ],
  }
  const result = exports.relevantOwnerRollup(item, new Set(['menno', 'anne-fleur', 'odette']), new Date('2026-10-08T10:00:00'), 35)
  assert.deepEqual(Array.from(result.relevantOwnerIds), ['menno'])
  assert.deepEqual(Array.from(result.historicalOwnerIds), ['anne-fleur', 'odette'])
  assert.equal(result.historicalOwnerIds.includes('manuel'), false)
})

test('relevant owner hours ignore completed and distant subitems', () => {
  const relevant = [
    sub({ ownerIds: ['menno', 'odette'], estHours: 10 }),
    sub({ ownerIds: ['menno'], estHours: 3 }),
  ]
  assert.deepEqual(JSON.parse(JSON.stringify(exports.relevantOwnerHours(relevant))), { menno: 8, odette: 5 })
})

test('agenda UI persists pie metadata and supports custom columns', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')
  assert.match(board, /k === 'ownerHours'/)
  assert.match(board, /!\('ownerHours' in updates\)/)
  assert.match(board, /quickMembers = sortedTeam\.slice\(0, 6\)/)
  assert.match(board, /Eigen kolom/)
  assert.match(registry, /id === 'omdenken'/)
  assert.match(registry, /key: 'dagen'/)
})
