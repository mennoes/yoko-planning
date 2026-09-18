import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function workload(overrides = {}) {
  const source = readFileSync(new URL('../lib/workload.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, require(id) {
    const mocks = {
      './boardsRegistry': { getBoardColor: () => '#579bfc' },
      './workloadCategory': { isVrijTitle: name => /vakantie|vrij/i.test(name), loadCategoryOverrides: () => overrides },
      './freeCapacity': { blockedHoursForWorkdays: days => days * 8 },
    }
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`)
    return mocks[id]
  } })
  return exports
}

const week = new Date('2026-09-14T00:00:00')
const project = (id, name, startDate, endDate, estHours, group = 'Projecten') => ({
  id, name, board: 'yoko', group, ownerIds: ['menno'], startDate, endDate,
  estHours, status: 'active', source: 'manual',
})

test('a full vacation week plus planned project hours shows overload, not just 40u', () => {
  const projects = [
    project('holiday', 'Vakantie', '2026-09-14', '2026-09-18', 0, 'Vrij'),
    project('work', 'Website', '2026-09-14', '2026-09-18', 16),
  ]
  const { memberContributions, memberTotalHours } = workload()
  const contributions = memberContributions(projects, 'menno', week)
  assert.equal(contributions.find(c => c.project.id === 'holiday').hours, 40)
  assert.equal(contributions.find(c => c.project.id === 'work').hours, 16)
  assert.equal(memberTotalHours(projects, 'menno', week), 56)
})

test('work spread across weeks keeps its hours in an overlapping vacation week', () => {
  const projects = [
    project('holiday', 'Vrij', '2026-09-14', '2026-09-18', 0, 'Vrij'),
    project('work', 'Long project', '2026-09-07', '2026-09-25', 30),
  ]
  const { memberTotalHours } = workload()
  assert.equal(memberTotalHours(projects, 'menno', week), 50)
})

test('a category-marked vacation with a neutral title also adds to project hours', () => {
  const projects = [
    project('holiday', 'Zwitserland', '2026-09-14', '2026-09-18', 0),
    project('work', 'Website', '2026-09-14', '2026-09-18', 8),
  ]
  const { memberTotalHours } = workload({ holiday: 'vrij' })
  assert.equal(memberTotalHours(projects, 'menno', week), 48)
})
