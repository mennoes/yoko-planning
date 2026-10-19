import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function laad(file, mocks = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const exports = {}
  runInNewContext(js, { exports, require(id) {
    if (id in mocks) return mocks[id]
    throw new Error(`Onverwachte afhankelijkheid ${id}`)
  } })
  return exports
}

const { membersWithWorkInWindow, FREELANCER_ACTIVE_DAYS } = laad('../lib/freelancerActivity.ts')

const NU = new Date('2026-10-19T12:00:00')
const dag = n => {
  const d = new Date(NU)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const project = (ownerIds, start, eind, status = 'active') => ({
  id: `p${start}`, name: 'Werk', board: 'yoko', ownerIds,
  startDate: start, endDate: eind, estHours: 8, status,
})

test('drie weken terug en drie weken vooruit is het venster', () => {
  assert.equal(FREELANCER_ACTIVE_DAYS, 21)
})

test('werk van vorige week maakt iemand actief', () => {
  const ids = membersWithWorkInWindow([project(['kars'], dag(-7), dag(-5))], { now: NU })
  assert.ok(ids.has('kars'))
})

test('werk over twee weken maakt iemand actief', () => {
  const ids = membersWithWorkInWindow([project(['marieke'], dag(14), dag(16))], { now: NU })
  assert.ok(ids.has('marieke'))
})

test('afgerond werk van vorige week telt mee', () => {
  // 'Afgelopen drie weken voor ons gefreelancet' gaat juist over werk dat
  // al klaar is; dat wegfilteren zou iedereen die net klaar is op inactief
  // zetten.
  const ids = membersWithWorkInWindow([project(['kars'], dag(-10), dag(-9), 'done')], { now: NU })
  assert.ok(ids.has('kars'))
})

test('werk van vier weken geleden telt niet meer', () => {
  const ids = membersWithWorkInWindow([project(['oud'], dag(-30), dag(-28))], { now: NU })
  assert.equal(ids.has('oud'), false)
})

test('werk over vier weken telt nog niet', () => {
  const ids = membersWithWorkInWindow([project(['later'], dag(28), dag(30))], { now: NU })
  assert.equal(ids.has('later'), false)
})

test('de randen van het venster tellen mee', () => {
  assert.ok(membersWithWorkInWindow([project(['a'], dag(-21), dag(-21))], { now: NU }).has('a'))
  assert.ok(membersWithWorkInWindow([project(['b'], dag(21), dag(21))], { now: NU }).has('b'))
  assert.equal(membersWithWorkInWindow([project(['c'], dag(-22), dag(-22))], { now: NU }).has('c'), false)
  assert.equal(membersWithWorkInWindow([project(['d'], dag(22), dag(22))], { now: NU }).has('d'), false)
})

test('een lange klus die over het venster heen loopt telt mee', () => {
  // Begonnen vóór het venster, loopt er nog doorheen: dat is werk dat nú
  // gebeurt, ook al valt geen van beide datums binnen de drie weken.
  const ids = membersWithWorkInWindow([project(['lang'], dag(-60), dag(60))], { now: NU })
  assert.ok(ids.has('lang'))
})

test('werk zonder datum zegt niets en telt dus niet', () => {
  const ids = membersWithWorkInWindow([project(['leeg'], null, null)], { now: NU })
  assert.equal(ids.has('leeg'), false)
})

test('alle eigenaren van een gedeeld project tellen mee', () => {
  const ids = membersWithWorkInWindow([project(['kars', 'marieke'], dag(1), dag(2))], { now: NU })
  assert.ok(ids.has('kars') && ids.has('marieke'))
})

test('met includeDone uit telt afgerond werk niet', () => {
  const ids = membersWithWorkInWindow([project(['kars'], dag(-3), dag(-2), 'done')], { now: NU, includeDone: false })
  assert.equal(ids.has('kars'), false)
})
