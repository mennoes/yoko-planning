import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const exports = {}
runInNewContext(ts.transpileModule(
  readFileSync(new URL('../lib/subitemDateSuggestions.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports })

const suggest = exports.suggestSubitemDateRanges
const suggestPlans = exports.suggestSubitemPlans
const plain = value => JSON.parse(JSON.stringify(value))

test('verdeelt de periode van een hoofditem over werkdagen zonder overlap', () => {
  assert.deepEqual(plain(suggest('2026-12-16', '2027-01-15', [
    { id: 's1' }, { id: 's2' }, { id: 's3' },
  ])), {
    s1: { startDate: '2026-12-16', endDate: '2026-12-25' },
    s2: { startDate: '2026-12-28', endDate: '2027-01-05' },
    s3: { startDate: '2027-01-06', endDate: '2027-01-15' },
  })
})

test('laat bestaande datums ongemoeid en behoudt hun plaats in de verdeling', () => {
  assert.deepEqual(plain(suggest('2026-12-01', '2026-12-09', [
    { id: 's1' },
    { id: 's2', startDate: '2026-12-04', endDate: '2026-12-05' },
    { id: 's3' },
  ])), {
    s1: { startDate: '2026-12-01', endDate: '2026-12-02' },
    s3: { startDate: '2026-12-08', endDate: '2026-12-09' },
  })
})

test('maakt zonder ouderperiode geen suggesties en normaliseert omgekeerde datums', () => {
  assert.deepEqual(plain(suggest(null, null, [{ id: 's1' }])), {})
  assert.deepEqual(plain(suggest('2026-12-03', '2026-12-01', [{ id: 's1' }])), {
    s1: { startDate: '2026-12-01', endDate: '2026-12-03' },
  })
})

test('leidt zonder hoofdtimeline de planning terug vanaf de hoofddeadline', () => {
  const plans = plain(suggestPlans(null, null, '2026-11-20', [
    { id: 'edit', estHours: 16 },
    { id: 'motion', estHours: 8 },
  ]))

  assert.deepEqual(plans.edit, {
    startDate: '2026-11-18',
    endDate: '2026-11-19',
    deadline: '2026-11-19',
    effortDays: 2,
    totalEffortDays: 3,
    availableDays: 3,
    isTight: false,
  })
  assert.deepEqual(plans.motion, {
    startDate: '2026-11-20',
    endDate: '2026-11-20',
    deadline: '2026-11-20',
    effortDays: 1,
    totalEffortDays: 3,
    availableDays: 3,
    isTight: false,
  })
})

test('weegt subitems op uren en begrenst ze met de hoofddeadline', () => {
  const plans = plain(suggestPlans('2026-12-01', '2026-12-11', '2026-12-09', [
    { id: 'kort', estHours: 8 },
    { id: 'lang', estHours: 24 },
  ]))

  assert.equal(plans.kort.startDate, '2026-12-01')
  assert.equal(plans.kort.deadline, '2026-12-02')
  assert.equal(plans.lang.startDate, '2026-12-03')
  assert.equal(plans.lang.deadline, '2026-12-09')
  assert.equal(plans.lang.availableDays, 7)
  assert.equal(plans.lang.isTight, false)
})

test('markeert een planning als krap als er minder werkdagen dan werk zijn', () => {
  const plans = plain(suggestPlans('2026-11-19', '2026-11-20', '2026-11-20', [
    { id: 'edit', estHours: 24 },
    { id: 'motion', estHours: 16 },
  ]))

  assert.equal(plans.edit.isTight, true)
  assert.equal(plans.motion.isTight, true)
  assert.equal(plans.edit.availableDays, 2)
})

test('de agenda toont de voorgestelde timeline en deadline zonder ze vanzelf op te slaan', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  assert.match(board, /suggestSubitemPlans\(parentStartDate, parentEndDate, parentDeadline, subitems\)/)
  assert.match(board, /suggestedRange=\{suggestedPlan\}/)
  assert.match(board, /suggestedValue=\{suggestedPlan\?\.deadline\}/)
  assert.match(board, /onClick=\{\(\) => onChange\(suggestedValue\)\}/)
})
