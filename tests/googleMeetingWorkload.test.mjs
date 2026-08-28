import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the real transformation with only its storage/config boundary
// replaced. No browser session, API calls, or production records involved.
function loadModule(file, mocks, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  runInNewContext(js, { exports, URL, ...globals, require(id) {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`)
    return mocks[id]
  } })
  return exports
}
const category = { isVrijTitle: () => false, loadCategoryOverrides: () => ({}) }
const { groupsToProjects } = loadModule('../lib/workload.ts', {
  './boardsRegistry': { getBoardColor: () => '#000' }, './workloadCategory': category,
})
const meeting = {
  id: 'meeting', name: 'Project overleg', ownerIds: ['menno'], status: '',
  startDate: '2099-09-01', endDate: '2099-09-01', estHours: 1,
  source: 'google', googleSeriesId: 'series',
}
const item = {
  id: 'project', name: 'Vooruitblik', ownerIds: ['menno'], source: 'manual', status: '',
  startDate: '2099-09-01', endDate: '2099-09-30', estHours: 40,
}
const groups = subitems => [{ id: 'projects', name: 'Projecten', items: [{ ...item, subitems }] }]

test('auto-nested meeting adds hours without replacing the original project', () => {
  const output = groupsToProjects('vlaanderen', groups([meeting]))
  assert.equal(output.length, 2)
  assert.equal(output.reduce((sum, p) => sum + p.estHours, 0), 41)
  assert.equal(output.find(p => p.id === 'vlaanderen__project').estHours, 40)
  assert.equal(output.find(p => p.id.endsWith('__si0')).source, 'google')
})
test('existing dated subitems and indices stay intact when meetings are attached', () => {
  const manual = { ...meeting, id: 'work', source: 'manual', googleSeriesId: undefined, estHours: 8, name: 'Artwork' }
  const output = groupsToProjects('vlaanderen', groups([manual, meeting]))
  assert.equal(output.reduce((sum, p) => sum + p.estHours, 0), 9)
  assert.equal(output.find(p => p.id.endsWith('__si0')).source, 'manual')
  assert.equal(output.find(p => p.id.endsWith('__si1')).source, 'google')
})
test('existing undated subtasks retain their previous workload', () => {
  const manual = { ...meeting, id: 'work', source: 'manual', googleSeriesId: undefined, startDate: null, endDate: null, estHours: 8 }
  const before = groupsToProjects('vlaanderen', groups([manual]))
  const after = groupsToProjects('vlaanderen', groups([manual, meeting]))
  assert.equal(after.reduce((sum, p) => sum + p.estHours, 0), before[0].estHours + 1)
})
test('a completed attached meeting does not hide the parent task or change its dates', () => {
  const mockGroups = groups([{ ...meeting, status: 'Done', startDate: '2000-01-01', endDate: '2000-01-01' }])
  const mocks = {
    './boardStore': { loadGroups: board => board === 'vlaanderen' ? mockGroups : [] },
    './workloadCategory': category,
  }
  for (const board of ['yoko', 'pnp', 'nederland', 'vlaanderen', 'dienjaar']) mocks[`@/data/boards/${board}.json`] = { groups: [] }
  const api = loadModule('../lib/todoProjectSeed.ts', mocks, { window: { localStorage: { getItem: () => null } } })
  const todos = api.mergeMemberTodoItems([], 'menno')
  assert.equal(todos.length, 1)
  assert.equal(todos[0].projectRef.itemId, 'project')
  assert.equal(todos[0].projectRef.startDate, '2099-09-01')
})
