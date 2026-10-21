// De taart in het item-venster hoort op te tellen tot het uren-veld dat
// ernaast staat.
//
// De klacht: bij een klus van 84.3u stond er een taart van 52u. Dat kwam
// doordat de verdeling alleen over de subitems van de komende vijf weken
// ging, terwijl het uren-veld álle subitems optelt. Allebei 'klopten' op
// hun eigen manier, en naast elkaar in één venster is dat gewoon fout.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function laad(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(js, {
    exports, Date, Math, Number, String, Array, Set, Object, isFinite,
    require() { return {} },
  })
  return exports
}

const { relevantOwnerHours } = laad('../lib/relevantOwners.ts')
const { itemRollupHours } = laad('../lib/itemHours.ts')

const sub = (naam, uren, owners, extra = {}) => ({
  id: naam, name: naam, estHours: uren, ownerIds: owners,
  status: 'Working on it', startDate: '2026-11-02', endDate: '2026-11-06', ...extra,
})
const som = verdeling => Math.round(Object.values(verdeling).reduce((a, b) => a + b, 0) * 10) / 10

test('de verdeling telt op tot precies de uren van het item', () => {
  const subs = [
    sub('Research', 20, ['menno']),
    sub('Montage', 34.3, ['vincent']),
    sub('Afwerking', 30, ['menno', 'vincent']),
  ]
  const verdeling = relevantOwnerHours(subs)
  assert.equal(som(verdeling), itemRollupHours({ estHours: 0 }, subs))
  assert.equal(som(verdeling), 84.3)
})

test('subitems die al af zijn tellen gewoon mee', () => {
  // Het uren-veld telt ze ook mee, dus de taart moet dat ook doen —
  // anders staat er 52 onder 84.3.
  const subs = [
    sub('Research', 32, ['menno'], { status: 'Done' }),
    sub('Montage', 52, ['vincent']),
  ]
  const verdeling = relevantOwnerHours(subs)
  assert.equal(som(verdeling), 84)
  assert.equal(verdeling.menno, 32)
})

test('subitems ver in de toekomst tellen ook mee', () => {
  // Precies wat er misging: alles buiten vijf weken viel uit de taart.
  const subs = [
    sub('Nu', 52, ['menno'], { startDate: '2026-11-02', endDate: '2026-11-06' }),
    sub('Later', 32.3, ['vincent'], { startDate: '2027-04-01', endDate: '2027-04-10' }),
  ]
  assert.equal(som(relevantOwnerHours(subs)), 84.3)
})

test('een subitem met twee eigenaren gaat eerlijk door tweeën', () => {
  const verdeling = relevantOwnerHours([sub('Samen', 30, ['menno', 'vincent'])])
  assert.equal(verdeling.menno, 15)
  assert.equal(verdeling.vincent, 15)
})

test('een eigen verdeling op een subitem blijft staan', () => {
  const verdeling = relevantOwnerHours([
    sub('Samen', 40, ['menno', 'vincent'], { ownerHours: { menno: 30, vincent: 10 } }),
  ])
  assert.equal(verdeling.menno, 30)
  assert.equal(verdeling.vincent, 10)
})

test('uren bij een subitem laten dat aandeel groeien, en de rest niet', () => {
  const voor = relevantOwnerHours([sub('Research', 20, ['menno']), sub('Montage', 30, ['vincent'])])
  const na   = relevantOwnerHours([sub('Research', 40, ['menno']), sub('Montage', 30, ['vincent'])])
  assert.equal(voor.menno, 20)
  assert.equal(na.menno, 40, 'de uren van Menno groeien mee')
  assert.equal(na.vincent, voor.vincent, 'en die van Vincent blijven staan')
  assert.equal(som(na), 70)
})

test('uren zonder eigenaar vallen uit de taart — dat is het gat dat we tonen', () => {
  // Deze horen wél in het uren-veld. Het verschil is geen fout maar
  // informatie: er staan uren klaar waar niemand op zit.
  const subs = [sub('Research', 20, ['menno']), sub('Nog niemand', 12, [])]
  const verdeling = relevantOwnerHours(subs)
  const totaal = itemRollupHours({ estHours: 0 }, subs)
  assert.equal(som(verdeling), 20)
  assert.equal(totaal, 32)
  assert.equal(Math.round((totaal - som(verdeling)) * 10) / 10, 12, 'het gat is precies dat subitem')
})
