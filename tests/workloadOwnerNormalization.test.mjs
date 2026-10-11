import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/workload.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
runInNewContext(js, { exports, URL, require(id) {
  if (id === './boardsRegistry') return { getBoardColor: () => '#000' }
  if (id === './workloadCategory') return { isVrijTitle: () => false, loadCategoryOverrides: () => ({}) }
  if (id === './freeCapacity') return { blockedHoursForWorkdays: days => days * 8 }
  throw new Error(`Unexpected dependency ${id}`)
} })

test('duplicate and unassigned owners cannot change a project hour split', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'project', name: 'Project', ownerIds: ['menno', 'unassigned', 'menno'], status: '',
    startDate: '2026-10-12', endDate: '2026-10-16', estHours: 40,
  }] }]
  const project = exports.groupsToProjects('yoko', groups)[0]
  assert.equal(JSON.stringify(project.ownerIds), JSON.stringify(['menno']))
  assert.equal(project.completionParentItemId, 'project')
  assert.equal(exports.projectHoursInWeek(project, 'menno', new Date('2026-10-12T12:00:00')), 40)
})

test('dated subitems carry their stable completion target without an agenda lookup', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'parent', name: 'Parent', ownerIds: ['menno', 'odette'], status: '',
    startDate: null, endDate: null, estHours: 8,
    subitems: [{ id: 'stable-sub', name: 'Sub', ownerIds: ['menno', 'odette'], status: '', startDate: '2026-10-12', endDate: '2026-10-13', estHours: 8 }],
  }] }]
  const project = exports.groupsToProjects('yoko', groups)[0]
  assert.equal(project.completionParentItemId, 'parent')
  assert.equal(project.completionSubitemId, 'stable-sub')
})
