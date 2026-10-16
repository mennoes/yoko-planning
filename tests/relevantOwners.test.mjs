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
  const result = exports.relevantOwnerRollup(item, new Set(['menno', 'anne-fleur', 'odette', 'manuel']), new Date('2026-10-08T10:00:00'), 35)
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

test('parent rollup uses the stored distribution of relevant subitems', () => {
  const relevant = [
    sub({ ownerIds: ['menno', 'odette'], estHours: 24, ownerHours: { menno: 2.5, odette: 21.5 } }),
    sub({ ownerIds: ['menno'], estHours: 1.6, ownerHours: { menno: 1.6 } }),
  ]
  assert.deepEqual(JSON.parse(JSON.stringify(exports.relevantOwnerHours(relevant))), { menno: 4.1, odette: 21.5 })
})

test('agenda UI persists pie metadata and supports custom columns', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')
  assert.match(board, /ownerHours: distribution/)
  assert.match(board, /nameOverride: true/)
  assert.match(board, /!\('ownerHours' in updates\)/)
  assert.match(board, /quickMembers = sortedTeam\.slice\(0, 6\)/)
  assert.match(board, /Eigen kolom/)
  assert.match(registry, /id === 'omdenken'/)
  assert.match(registry, /key: 'dagen'/)
})

test('een afgerond hoofditem toont de eigenaren van zijn subitems', () => {
  // Alle subitems op Done: stap 1 van de terugval levert niemand op, en
  // het hoofditem heeft zelf geen eigenaren. De rij stond daardoor leeg
  // terwijl je juist wil zien wie 't gedaan heeft.
  const item = {
    ownerIds: [],
    subitems: [
      sub({ ownerIds: ['menno'], status: 'Done', estHours: 4 }),
      sub({ ownerIds: ['menno', 'odette'], status: 'Done', estHours: 6 }),
    ],
  }
  const result = exports.relevantOwnerRollup(item, new Set(['menno', 'odette']), new Date('2026-10-08T10:00:00'), 35)
  assert.deepEqual(Array.from(result.relevantOwnerIds), [])
  assert.deepEqual(Array.from(result.displayOwnerIds), ['menno', 'odette'])
  assert.equal(result.displaySubitems.length, 2)
  assert.deepEqual(Array.from(result.historicalOwnerIds), [])
  // De uren van die afgeronde subitems blijven zo ook leesbaar.
  assert.deepEqual(JSON.parse(JSON.stringify(exports.relevantOwnerHours(result.displaySubitems))), { menno: 7, odette: 3 })
})

test('eigen eigenaren van het hoofditem gaan voor op afgeronde subitem-eigenaren', () => {
  const item = {
    ownerIds: ['anne-fleur'],
    subitems: [sub({ ownerIds: ['odette'], status: 'Done' })],
  }
  const result = exports.relevantOwnerRollup(item, new Set(['anne-fleur', 'odette']), new Date('2026-10-08T10:00:00'), 35)
  assert.deepEqual(Array.from(result.displayOwnerIds), ['anne-fleur'])
  // Geen subitem-verdeling: de hoofdregel houdt z'n eigen urenverdeling.
  assert.equal(result.displaySubitems.length, 0)
  assert.deepEqual(Array.from(result.historicalOwnerIds), ['odette'])
})

test('lopende subitems blijven de bron zolang die er zijn', () => {
  const item = {
    ownerIds: ['anne-fleur'],
    subitems: [sub({ ownerIds: ['menno'] }), sub({ ownerIds: ['odette'], status: 'Done' })],
  }
  const result = exports.relevantOwnerRollup(item, new Set(['menno', 'odette', 'anne-fleur']), new Date('2026-10-08T10:00:00'), 35)
  assert.deepEqual(Array.from(result.displayOwnerIds), ['menno'])
  assert.deepEqual(Array.from(result.historicalOwnerIds), ['odette'])
})

test('de agenda-rij gebruikt de terugval, niet alleen de lopende subitems', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  assert.match(board, /updates\.ownerIds = ownerRollup\.displayOwnerIds/)
  assert.match(board, /relevantOwnerHours\(ownerRollup\.displaySubitems\)/)
  // Zonder subitem-verdeling niet de handmatige verdeling weggooien.
  assert.match(board, /updates\.ownerHours = Object\.keys\(rolled\)\.length > 0 \? rolled : item\.ownerHours/)
})
