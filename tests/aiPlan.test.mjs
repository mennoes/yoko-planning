import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// De echte module draaien; dit is puur rekenwerk zonder browser of
// netwerk. Wat het model teruggeeft is gegeven, geen instructie — deze
// tests leggen vast wat er met rommel gebeurt.
function laad() {
  const source = readFileSync(new URL('../lib/aiPlan.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Number, Math, Array, JSON, String })
  return exports
}

const context = {
  today: '2026-10-28',
  boardName: 'yoko',
  groupNames: ['Projecten', 'Done'],
  members: [
    { id: 'menno', name: 'Menno' },
    { id: 'odette', name: 'Odette' },
    { id: 'anne-fleur', name: 'Anne-Fleur' },
  ],
}

const { normalizePlan, planToBoardItem, planSystemPrompt, MAX_SUBITEMS } = laad()

test('een compleet voorstel komt er herkenbaar uit', () => {
  const result = normalizePlan({
    name: 'NKO Explainer',
    groupName: 'projecten',
    startDate: '2026-11-02',
    endDate: '2026-11-20',
    ownerIds: ['Odette', 'menno'],
    notes: 'Twee minuten, Nederlands gesproken.',
    subitems: [
      { name: 'Script', startDate: '2026-11-02', endDate: '2026-11-04', estHours: 8, ownerIds: ['Menno'] },
      { name: 'Animatie', startDate: '2026-11-09', endDate: '2026-11-20', estHours: 24, ownerIds: ['Odette'] },
    ],
  }, context)
  assert.equal(result.ok, true)
  const plan = result.plan
  assert.equal(plan.name, 'NKO Explainer')
  // De groepsnaam wordt teruggebracht tot de echte schrijfwijze.
  assert.equal(plan.groupName, 'Projecten')
  assert.deepEqual(Array.from(plan.ownerIds), ['odette', 'menno'])
  // De uren van de subitems zijn het totaal; twee getallen die niet
  // kloppen is erger dan één.
  assert.equal(plan.estHours, 32)
  assert.equal(plan.subitems.length, 2)
})

test('onbekende mensen worden weggelaten in plaats van gegokt', () => {
  const { plan } = normalizePlan({ name: 'Klus', ownerIds: ['Menno', 'Jan Jansen', ''] }, context)
  assert.deepEqual(Array.from(plan.ownerIds), ['menno'])
})

test('een voornaam is genoeg, een onbekende groep niet', () => {
  const { plan } = normalizePlan({ name: 'Klus', ownerIds: ['anne-fleur'], groupName: 'Archief' }, context)
  assert.deepEqual(Array.from(plan.ownerIds), ['anne-fleur'])
  assert.equal(plan.groupName, null)
})

test('rare datums en uren worden rechtgezet', () => {
  const { plan } = normalizePlan({
    name: 'Klus',
    startDate: '2026-11-10', endDate: '2026-11-03',   // eind vóór start
    estHours: -5,
    subitems: [
      { name: 'Alleen een startdatum', startDate: '2026-11-04' },
      { name: 'Onzindatum', startDate: 'volgende week' },
      { name: '' },                                    // geen naam: valt af
    ],
  }, context)
  assert.equal(plan.endDate, '2026-11-10', 'een einddatum vóór de start wordt één dag')
  assert.equal(plan.estHours, 0, 'negatieve uren tellen als niets ingevuld')
  assert.equal(plan.subitems.length, 2)
  assert.deepEqual(
    { start: plan.subitems[0].startDate, eind: plan.subitems[0].endDate },
    { start: '2026-11-04', eind: '2026-11-04' },
    'één datum betekent die ene dag')
  assert.equal(plan.subitems[1].startDate, null)
})

test('zonder eigen periode volgt het item de subitems', () => {
  const { plan } = normalizePlan({
    name: 'Klus',
    subitems: [
      { name: 'Twee', startDate: '2026-11-09', endDate: '2026-11-12' },
      { name: 'Een', startDate: '2026-11-02', endDate: '2026-11-04' },
    ],
  }, context)
  assert.equal(plan.startDate, '2026-11-02')
  assert.equal(plan.endDate, '2026-11-12')
})

test('zonder naam is het geen voorstel', () => {
  assert.equal(normalizePlan({ subitems: [{ name: 'Script' }] }, context).ok, false)
  assert.equal(normalizePlan(null, context).ok, false)
  assert.equal(normalizePlan('Hier is je planning!', context).ok, false)
})

test('een eindeloze lijst wordt afgekapt', () => {
  const veel = Array.from({ length: 80 }, (_, i) => ({ name: `Stap ${i}` }))
  const { plan } = normalizePlan({ name: 'Klus', subitems: veel }, context)
  assert.equal(plan.subitems.length, MAX_SUBITEMS)
})

test('het voorstel wordt een item zoals elk ander', () => {
  const { plan } = normalizePlan({
    name: 'NKO Explainer',
    subitems: [{ name: 'Script', estHours: 8, ownerIds: ['Menno'] }],
  }, context)
  let n = 0
  const item = planToBoardItem(plan, () => `id${n++}`)
  assert.equal(item.name, 'NKO Explainer')
  assert.equal(item.subitems.length, 1)
  assert.equal(item.subitems[0].name, 'Script')
  assert.equal(item.subitems[0].status, '', 'een nieuw item begint zonder status')
  // Met subitems dragen die de uren; anders zou het dubbel tellen.
  assert.equal(item.estHours, 0)
  const zonderSubs = planToBoardItem(
    normalizePlan({ name: 'Losse klus', estHours: 12 }, context).plan, () => 'x')
  assert.equal(zonderSubs.estHours, 12)
  assert.equal(zonderSubs.dagen, 1.5)
})

test('de opdracht aan het model noemt het team, de groepen en vandaag', () => {
  const prompt = planSystemPrompt(context)
  assert.match(prompt, /2026-10-28/)
  assert.match(prompt, /Menno \(menno\)/)
  assert.match(prompt, /Projecten/)
  assert.match(prompt, /weekend/, 'niets in het weekend plannen')
})
