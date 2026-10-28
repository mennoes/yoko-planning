import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Puur rekenwerk: stappen uitzetten op werkdagen, terug vanaf de
// deadline. Geen model, geen netwerk — precies het punt van dit ding.
function laad() {
  const source = readFileSync(new URL('../lib/sjabloonPlan.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Number, Math, Array, Set, JSON, String })
  return exports
}

const { planUitSjabloon, tekstNaarStappen, stappenNaarTekst, SJABLONEN, MAX_STAPPEN } = laad()

const dagNaam = iso => new Date(`${iso}T00:00:00`).getDay()

test('de laatste stap eindigt op de deadline en de rest ligt ervoor', () => {
  // Vrijdag 20 november 2026.
  const { ok, plan } = planUitSjabloon({
    naam: 'NKO Explainer',
    deadline: '2026-11-20',
    stappen: [
      { naam: 'Script', dagen: 2 },
      { naam: 'Animatie', dagen: 3 },
    ],
  })
  assert.equal(ok, true)
  assert.equal(plan.subitems.length, 2)
  assert.equal(plan.subitems[1].endDate, '2026-11-20', 'de laatste stap eindigt op de deadline')
  // Animatie: 3 werkdagen t/m vrijdag → woensdag t/m vrijdag.
  assert.equal(plan.subitems[1].startDate, '2026-11-18')
  // Script: 2 werkdagen, eindigend op de werkdag ervoor (dinsdag).
  assert.equal(plan.subitems[0].endDate, '2026-11-17')
  assert.equal(plan.subitems[0].startDate, '2026-11-16')
  // Het item zelf loopt van de eerste tot de laatste stap.
  assert.equal(plan.startDate, '2026-11-16')
  assert.equal(plan.endDate, '2026-11-20')
})

test('er wordt nooit in het weekend gepland', () => {
  const { plan } = planUitSjabloon({
    naam: 'Lange klus',
    deadline: '2026-11-20',
    stappen: SJABLONEN[0].stappen,
  })
  for (const sub of plan.subitems) {
    assert.ok(dagNaam(sub.startDate) >= 1 && dagNaam(sub.startDate) <= 5, `${sub.name} begint op een werkdag`)
    assert.ok(dagNaam(sub.endDate) >= 1 && dagNaam(sub.endDate) <= 5, `${sub.name} eindigt op een werkdag`)
  }
})

test('een deadline in het weekend schuift naar de vrijdag ervoor', () => {
  // Zaterdag 21 november 2026.
  const { plan } = planUitSjabloon({
    naam: 'Klus', deadline: '2026-11-21', stappen: [{ naam: 'Afronden', dagen: 1 }],
  })
  assert.equal(plan.subitems[0].endDate, '2026-11-20')
})

test('uren volgen uit de werkdagen', () => {
  const { plan } = planUitSjabloon({
    naam: 'Klus', deadline: '2026-11-20',
    stappen: [{ naam: 'Script', dagen: 2 }, { naam: 'Animatie', dagen: 3 }],
  })
  assert.equal(plan.subitems[0].estHours, 16)
  assert.equal(plan.subitems[1].estHours, 24)
  assert.equal(plan.estHours, 40)
})

test('zonder naam, datum of stappen komt er een uitleg in plaats van een planning', () => {
  const stappen = [{ naam: 'Script', dagen: 1 }]
  assert.match(planUitSjabloon({ naam: '  ', deadline: '2026-11-20', stappen }).error, /naam/i)
  assert.match(planUitSjabloon({ naam: 'Klus', deadline: '', stappen }).error, /datum/i)
  assert.match(planUitSjabloon({ naam: 'Klus', deadline: 'volgende week', stappen }).error, /datum/i)
  assert.match(planUitSjabloon({ naam: 'Klus', deadline: '2026-11-20', stappen: [] }).error, /stap/i)
})

test('de stappen lezen zoals iemand ze opschrijft', () => {
  const stappen = tekstNaarStappen([
    'Script · 2d',
    'Storyboard - 3 dagen',
    'Animatie (5)',
    'Oplevering',
    '   ',
  ].join('\n'))
  assert.deepEqual(Array.from(stappen, s => [s.naam, s.dagen]), [
    ['Script', 2],
    ['Storyboard', 3],
    ['Animatie', 5],
    // Niets erachter betekent één werkdag.
    ['Oplevering', 1],
  ])
})

test('heen en weer tussen tekst en stappen verandert niets', () => {
  for (const sjabloon of SJABLONEN) {
    const terug = tekstNaarStappen(stappenNaarTekst(sjabloon.stappen))
    assert.deepEqual(
      Array.from(terug, s => [s.naam, s.dagen]),
      // Array.from aan beide kanten: objecten uit de vm hebben een
      // andere prototype-keten, en deepEqual struikelt daarover.
      Array.from(sjabloon.stappen, s => [s.naam, s.dagen]),
      sjabloon.naam)
  }
})

test('een eindeloze lijst wordt afgekapt', () => {
  const veel = Array.from({ length: 80 }, (_, i) => `Stap ${i}`).join('\n')
  assert.equal(tekstNaarStappen(veel).length, MAX_STAPPEN)
})
