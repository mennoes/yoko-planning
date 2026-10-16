import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Reproduceer de Nederlandse wintertijdwissel onafhankelijk van de timezone
// van de machine waarop de tests draaien.
process.env.TZ = 'Europe/Amsterdam'

const source = readFileSync(new URL('../lib/workload.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const itemHoursSource = readFileSync(new URL('../lib/itemHours.ts', import.meta.url), 'utf8')
const itemHoursJs = ts.transpileModule(itemHoursSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const itemHours = {}
runInNewContext(itemHoursJs, { exports: itemHours })
const exports = {}
runInNewContext(js, { exports, URL, require(id) {
  if (id === './boardsRegistry') return { getBoardColor: () => '#000' }
  if (id === './workloadCategory') return { isVrijTitle: () => false, loadCategoryOverrides: () => ({}) }
  if (id === './freeCapacity') return { blockedHoursForWorkdays: days => days * 8 }
  if (id === './recurringMeetingWindow') return { visibleRecurringSubitems: (_source, rows) => rows }
  if (id === './itemHours') return itemHours
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

test('parent rollup is not added again on top of dated subitems', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'parent', name: 'Project', ownerIds: ['menno'], status: '',
    startDate: '2026-10-12', endDate: '2026-10-16', estHours: 88,
    subitems: [
      { id: 'a', name: 'A', ownerIds: ['menno'], status: '', startDate: '2026-10-12', endDate: '2026-10-14', estHours: 80 },
      { id: 'b', name: 'B', ownerIds: ['menno'], status: '', startDate: '2026-10-15', endDate: '2026-10-16', estHours: 8 },
    ],
  }] }]
  const projects = exports.groupsToProjects('yoko', groups)
  assert.equal(projects.length, 2)
  assert.equal(projects.reduce((sum, project) => sum + project.estHours, 0), 88)
})

test('subitems without dates use the parent timeline without duplicating its rollup', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'parent', name: 'Project', ownerIds: ['menno'], status: '',
    startDate: '2026-10-12', endDate: '2026-10-16', estHours: 40,
    subitems: [
      { id: 'a', name: 'A', ownerIds: ['menno'], status: '', estHours: 12 },
      { id: 'b', name: 'B', ownerIds: ['menno'], status: '', estHours: 8 },
    ],
  }] }]
  const projects = exports.groupsToProjects('yoko', groups)
  assert.equal(projects.length, 1)
  assert.equal(projects[0].estHours, 20)
  assert.equal(exports.projectHoursInWeek(projects[0], 'menno', new Date('2026-10-12T12:00:00')), 20)
})

test('parent hours remain available when subitems are only zero-hour placeholders', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'parent', name: 'Project', ownerIds: ['menno'], status: '',
    startDate: '2026-10-12', endDate: '2026-10-16', estHours: 40,
    subitems: [{ id: 'placeholder', name: 'Later', ownerIds: ['menno'], status: '', estHours: 0 }],
  }] }]
  const projects = exports.groupsToProjects('yoko', groups)
  assert.equal(projects.length, 1)
  assert.equal(projects[0].estHours, 40)
})

test('stale owner hours are scaled to the current item total', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'experience', name: 'Experience', ownerIds: ['take'], status: '',
    startDate: '2026-10-19', endDate: '2026-11-06', estHours: 56,
    ownerHours: { take: 88 },
  }] }]
  const project = exports.groupsToProjects('pnp', groups)[0]
  assert.equal(project.estHours, 56)
  assert.equal(project.ownerHours.take, 56)
})

test('stale dated-subitem distribution cannot inflate its workload', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'parent', name: 'Parent', ownerIds: ['take', 'menno'], status: '',
    startDate: null, endDate: null, estHours: 0,
    subitems: [{
      id: 'sub', name: 'Sub', ownerIds: ['take', 'menno'], status: '',
      startDate: '2026-10-19', endDate: '2026-10-23', estHours: 24,
      ownerHours: { take: 24, menno: 24 },
    }],
  }] }]
  const project = exports.groupsToProjects('pnp', groups)[0]
  assert.equal(Object.values(project.ownerHours).reduce((sum, hours) => sum + hours, 0), 24)
  assert.equal(project.ownerHours.take, 12)
  assert.equal(project.ownerHours.menno, 12)
})

test('a missing share for one of multiple owners falls back to an equal distribution', () => {
  const groups = [{ id: 'work', name: 'Werk', items: [{
    id: 'shared', name: 'Gedeeld project', ownerIds: ['take', 'ander'], status: '',
    startDate: '2026-10-19', endDate: '2026-10-23', estHours: 24,
    ownerHours: { take: 24, ander: 0 },
  }] }]
  const project = exports.groupsToProjects('pnp', groups)[0]
  assert.equal(project.ownerHours.take, 12)
  assert.equal(project.ownerHours.ander, 12)
})

test('winter time does not inflate hours across adjacent weeks', () => {
  const project = {
    id: 'wintertijd', name: 'Experience', board: 'pnp', ownerIds: ['take'],
    startDate: '2026-10-15', endDate: '2026-10-29', estHours: 56,
    ownerHours: { take: 56 }, status: 'active',
  }
  const weeks = ['2026-10-12', '2026-10-19', '2026-10-26']
  const total = weeks.reduce((sum, start) =>
    sum + exports.projectHoursInWeek(project, 'take', new Date(`${start}T00:00:00`)), 0)
  // Elke week wordt op één decimaal afgerond; 56,1 is hooguit die 0,1
  // presentatieronding. De oude 24-uursloop kwam hier foutief op 61,6 uit.
  assert.equal(total, 56.1)
})
