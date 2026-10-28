import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Een mail uitpluizen: onderwerp, datum en het lijstje eruit. Geen
// model, dus het mag karig zijn — maar niet verzinnen.
function laad() {
  const source = readFileSync(new URL('../lib/mailNaarStappen.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, Date, Number, Math, Array, Set, JSON, String, RegExp, require: () => ({}) })
  return exports
}

const { mailNaarStappen, deadlineUitMail, stappenUitMail, naamUitMail } = laad()
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
  const uit = mailNaarStappen(MAIL, VANDAAG)
  assert.equal(uit.naam, 'Explainer over zonnepanelen')
  assert.equal(uit.deadline, '2026-12-11')
  assert.deepEqual(Array.from(uit.stappen, s => [s.naam, s.dagen]), [
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
  const uit = mailNaarStappen('Hoi, kunnen jullie een explainer maken? Graag voor 11 december.', VANDAAG)
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
