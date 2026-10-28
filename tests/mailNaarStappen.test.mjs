import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Een mail uitpluizen: onderwerp, datum en het lijstje eruit. Geen
// model, dus het mag karig zijn — maar niet verzinnen.
function laadModule(pad, mocks = {}) {
  const source = readFileSync(new URL(pad, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Number, Math, Array, Set, JSON, String, RegExp,
    require: id => mocks[id] ?? {} })
  return exports
}

// De échte sjablonen erbij: het herkennen van 'explainer' of 'podcast'
// leunt erop, en een nagebouwde lijst zou dat niet bewaken.
function laad() {
  const sjablonen = laadModule('../lib/sjabloonPlan.ts')
  return laadModule('../lib/mailNaarStappen.ts', { './sjabloonPlan': sjablonen })
}

const { mailNaarStappen, deadlineUitMail, stappenUitMail, naamUitMail,
        stappenUitZinnen, stappenUitRegels, sjabloonUitMail, ownersUitMail } = laad()
const namen = lijst => Array.from(lijst, s => [s.naam, s.dagen])
const VANDAAG = new Date(2026, 9, 28) // 28 oktober 2026

const MAIL = `Onderwerp: Explainer over zonnepanelen

Hoi Menno,

Zoals besproken hierbij de opdracht. We willen de video uiterlijk 11 december live zetten.

- Script schrijven (2 dagen)
- Storyboard
- Animatie maken (5 werkdagen)
- Feedbackronde met de klant

Alvast bedankt!

Met vriendelijke groet,
Joris
Verstuurd vanaf mijn iPhone`

test('onderwerp, datum en lijstje komen eruit', () => {
  const uit = mailNaarStappen(MAIL, { vandaag: VANDAAG })
  assert.equal(uit.naam, 'Explainer over zonnepanelen')
  assert.equal(uit.deadline, '2026-12-11')
  assert.equal(uit.bron, 'lijstje')
  assert.deepEqual(namen(uit.stappen), [
    ['Script schrijven', 2],
    ['Storyboard', 1],
    ['Animatie maken', 5],
    ['Feedbackronde met de klant', 1],
  ])
})

test('beleefdheden en kopregels zijn geen stappen', () => {
  const stappen = stappenUitMail([
    '- Hoi Menno',
    '- Script',
    '- Met vriendelijke groet',
    '-   ',
  ].join('\n'))
  assert.deepEqual(Array.from(stappen, s => s.naam), ['Script'])
})

test('zonder lijstje komt er niets uit, in plaats van een verzonnen planning', () => {
  const uit = mailNaarStappen('Hoi, kunnen jullie dit maken? Graag voor 11 december.', { vandaag: VANDAAG })
  assert.deepEqual(Array.from(uit.stappen), [])
  assert.equal(uit.deadline, '2026-12-11')
})

test('een datum zonder jaar die al geweest is, hoort bij volgend jaar', () => {
  assert.equal(deadlineUitMail('Graag voor 3 maart aanleveren.', VANDAAG), '2027-03-03')
  assert.equal(deadlineUitMail('Graag voor 3 december aanleveren.', VANDAAG), '2026-12-03')
})

test('datums in cijfers worden ook gelezen', () => {
  assert.equal(deadlineUitMail('Deadline: 11-12-2026', VANDAAG), '2026-12-11')
  assert.equal(deadlineUitMail('Deadline: 2026-12-11', VANDAAG), '2026-12-11')
  assert.equal(deadlineUitMail('Deadline: 11/12/26', VANDAAG), '2026-12-11')
  assert.equal(deadlineUitMail('Geen datum hier.', VANDAAG), null)
  assert.equal(deadlineUitMail('Op 31 februari dus niet.', VANDAAG), null)
})

test('een woord als uiterlijk wint van de datum van het bericht zelf', () => {
  const mail = [
    'Datum: 28 oktober 2026',
    'We spraken elkaar op 2 november.',
    'Het moet uiterlijk 18 december af zijn.',
    'Daarna gaan we op 20 december met vakantie.',
  ].join('\n')
  assert.equal(deadlineUitMail(mail, VANDAAG), '2026-12-18')
})

test('zonder onderwerpregel pakt hij de eerste zinnige regel', () => {
  const naam = naamUitMail('Hoi Menno,\n\nNieuwe explainer voor NKO\n\n- Script')
  assert.equal(naam, 'Nieuwe explainer voor NKO')
  assert.equal(naamUitMail('Hoi,\n\nGroet,\nJoris'), null)
})

// ── Zonder lijstje: wat er verder nog in een mail staat ───────────────

test('een zin met eerst/daarna/tot slot levert ook stappen op', () => {
  const stappen = stappenUitZinnen(
    'We beginnen met het script schrijven, daarna storyboard maken en tot slot animeren.')
  assert.deepEqual(namen(stappen), [
    ['Script schrijven', 1],
    ['Storyboard maken', 1],
    ['Animeren', 1],
  ])
})

test('een opsomming op één regel wordt uit elkaar gehaald', () => {
  const stappen = stappenUitZinnen('Planning: 1) script schrijven 2) storyboard maken (2 dagen) 3) animeren')
  assert.deepEqual(namen(stappen), [
    ['Script schrijven', 1],
    ['Storyboard maken', 2],
    ['Animeren', 1],
  ])
})

test('losse regels die met een werkwoord beginnen tellen als stap', () => {
  const stappen = stappenUitRegels([
    'Hoi Menno,',
    'Script schrijven',
    'Animatie maken (3 dagen)',
    'Dit wordt vast een mooie video.',
    'Met vriendelijke groet',
    'Opleveren',
  ].join('\n'))
  // De zin met een punt erachter valt af, en onder de groet kijkt hij
  // niet meer.
  assert.deepEqual(namen(stappen), [
    ['Script schrijven', 1],
    ['Animatie maken', 3],
  ])
})

test('dagen mogen ook in woorden of weken', () => {
  assert.deepEqual(namen(stappenUitMail([
    '- Script schrijven (twee dagen)',
    '- Animatie maken (1 week)',
    '- Montage halve dag',
  ].join('\n'))), [
    ['Script schrijven', 2],
    ['Animatie maken', 5],
    // Een halve dag blijft in dit raster één werkdag; de uren pas je
    // daarna aan.
    ['Montage', 1],
  ])
})

test('het soort klus wordt herkend aan de woorden in de mail', () => {
  assert.equal(sjabloonUitMail('Graag een explainer van 2 minuten').id, 'explainer')
  assert.equal(sjabloonUitMail('Nieuwe aflevering van de podcast').id, 'podcast')
  assert.equal(sjabloonUitMail('We willen een nieuw logo en huisstijl').id, 'ontwerp')
  assert.equal(sjabloonUitMail('Kun je even bellen?'), null)
})

test('zonder stappen maar met een herkenbaar onderwerp komt het sjabloon als beginpunt', () => {
  const uit = mailNaarStappen('Hoi, we willen een explainer laten maken. Uiterlijk 11 december.',
    { vandaag: VANDAAG })
  assert.equal(uit.bron, 'sjabloon')
  assert.equal(uit.sjabloonId, 'explainer')
  assert.ok(uit.stappen.length > 0, 'een beginpunt, geen leeg scherm')
})

test('namen van teamleden in de mail worden voorgesteld als eigenaar', () => {
  const leden = [{ name: 'Menno' }, { name: 'Odette' }, { name: 'Anne-Fleur' }]
  const uit = mailNaarStappen('Hoi Menno, kan Odette het storyboard doen?\n- Storyboard', { leden })
  assert.deepEqual(Array.from(uit.ownerNamen), ['Menno', 'Odette'])
})

test('zonder enig aanknopingspunt blijft het leeg', () => {
  const uit = mailNaarStappen('Hoi! Hoe gaat het? Groetjes, Joris', { vandaag: VANDAAG })
  assert.equal(uit.bron, 'geen')
  assert.deepEqual(Array.from(uit.stappen), [])
})
