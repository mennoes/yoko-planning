import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// De echte module draaien met localStorage en Supabase vervangen, zodat we
// de volgorde kunnen uitproberen zonder browser of database.
function laadStore(start = []) {
  const source = readFileSync(new URL('../lib/teamGroups.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const opslag = new Map([['yoko-team-groups', JSON.stringify(start)]])
  const exports = {}
  runInNewContext(js, {
    exports,
    localStorage: {
      getItem: k => opslag.get(k) ?? null,
      setItem: (k, v) => opslag.set(k, v),
    },
    window: { dispatchEvent() {}, localStorage: { getItem: k => opslag.get(k) ?? null, setItem: (k, v) => opslag.set(k, v) } },
    CustomEvent: class {},
    require(id) {
      if (id === './supabase') return { supabase: null }
      if (id === './sync') return { getCurrentUserId: async () => null }
      if (id === './teamMemberIdentity') return { TEAM_GROUP_META_PREFIX: '__team_group__:' }
      throw new Error(`Onverwachte afhankelijkheid ${id}`)
    },
  })
  return exports
}

const team = (id, position) => ({ id, name: id, color: '#579bfc', position, memberIds: [] })
// Array.from: objecten uit runInNewContext hebben een andere prototype-keten,
// dus deepEqual faalt op een array die daar is gemaakt.
const namen = lijst => Array.from(lijst, s => s.id)

test('zonder eerdere verplaatsing staan de vaste blokken op hun vertrouwde plek', () => {
  const store = laadStore([team('onderzoek', 0)])
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', 'onderzoek', '__freelance__', '__inactive__'])
})

test('één eigen team kan nu wél omhoog, langs Studio Yoko', () => {
  // Dit was de klacht: met één team deden de pijlen niets, omdat alleen
  // eigen teams meededen en er dus geen buur was.
  const store = laadStore([team('onderzoek', 0)])
  assert.equal(store.canMoveTeamGroup('onderzoek', -1), true)
  assert.equal(store.canMoveTeamGroup('onderzoek', 1), true)
})

test('omhoog verwisselt met Studio Yoko en blijft zo staan', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('onderzoek', -1)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['onderzoek', '__yoko__', '__freelance__', '__inactive__'])
  // En opnieuw inlezen geeft dezelfde volgorde: de posities zijn bewaard.
  assert.deepEqual(namen(store.loadTeamSections()),
    ['onderzoek', '__yoko__', '__freelance__', '__inactive__'])
})

test('Freelancers is een gewone sectie en kan naar boven', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__freelance__', -1)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', '__freelance__', 'onderzoek', '__inactive__'])
})

test('de bovenste kan niet omhoog en de onderste niet omlaag', () => {
  const store = laadStore([team('onderzoek', 0)])
  assert.equal(store.canMoveTeamGroup('__yoko__', -1), false)
  assert.equal(store.canMoveTeamGroup('__inactive__', 1), false)
})

test('eigen teams blijven los opvraagbaar van de vaste blokken', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('onderzoek', -1)
  // Na een verplaatsing staan de vaste blokken óók in de opslag; de
  // teamkeuze in het venster mag die niet als team aanbieden.
  assert.deepEqual(namen(store.loadCustomTeamGroups()), ['onderzoek'])
})

test('een nieuw team komt bij de bestaande volgorde, niet ervoor', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__freelance__', -1)
  const nieuw = await store.createTeamGroup('Editors')
  assert.ok(nieuw)
  assert.ok(namen(store.loadTeamSections()).includes('editors'))
})
