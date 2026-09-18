import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/weekPlanning.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
runInNewContext(js, { exports, Date })

test('week number in a new item name fills Monday-Friday and 40 hours', () => {
  const result = exports.inferWeekPlanning('Productie week 44', new Date('2026-09-18T12:00:00Z'))
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    week: 44,
    year: 2026,
    startDate: '2026-10-26',
    endDate: '2026-10-30',
    estHours: 40,
  })
})

test('week parsing supports an explicit year and rolls early weeks forward near year end', () => {
  assert.equal(exports.inferWeekPlanning('Week 1 2027', new Date('2026-09-18')).startDate, '2027-01-04')
  assert.equal(exports.inferWeekPlanning('wk 2', new Date('2026-12-20')).startDate, '2027-01-11')
  assert.equal(exports.inferWeekPlanning('week 99', new Date('2026-09-18')), null)
})

test('timeline calendar visibly includes ISO week numbers', () => {
  const ui = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  assert.match(ui, />wk<\/div>/)
  assert.match(ui, /title="Weeknummer"/)
  assert.match(ui, /selectedWeekLabel/)
  assert.match(ui, /defaultEditName \? inferWeekPlanning\(nameDraft\) : null/)
})

