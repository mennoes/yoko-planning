import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// De echte module draaien met localStorage en Supabase vervangen, zodat we
// de volgorde kunnen uitproberen zonder browser of database.
function laadStore(start = [], opties = {}) {
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
      if (id === './supabase') return { supabase: opties.supabase ?? null }
      if (id === './sync') return { getCurrentUserId: async () => opties.uid ?? null }
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
    ['__yoko__', 'onderzoek', '__freelance__', '__inactive__', '__overig__'])
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
    ['onderzoek', '__yoko__', '__freelance__', '__inactive__', '__overig__'])
  // En opnieuw inlezen geeft dezelfde volgorde: de posities zijn bewaard.
  assert.deepEqual(namen(store.loadTeamSections()),
    ['onderzoek', '__yoko__', '__freelance__', '__inactive__', '__overig__'])
})

test('Freelancers is een gewone sectie en kan naar boven', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__freelance__', -1)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', '__freelance__', 'onderzoek', '__inactive__', '__overig__'])
})

test('de bovenste kan niet omhoog en de onderste niet omlaag', () => {
  const store = laadStore([team('onderzoek', 0)])
  assert.equal(store.canMoveTeamGroup('__yoko__', -1), false)
  assert.equal(store.canMoveTeamGroup('__overig__', 1), false)
  assert.equal(store.canMoveTeamGroup('__inactive__', 1), true, 'die heeft Overig nog onder zich')
})

test('eigen teams blijven los opvraagbaar van de vaste blokken', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('onderzoek', -1)
  // Na een verplaatsing staan de vaste blokken óók in de opslag; de
  // teamkeuze in het venster mag die niet als team aanbieden.
  assert.deepEqual(namen(store.loadCustomTeamGroups()), ['onderzoek'])
})

test('zonder database blijft een verschuiving gewoon staan', async () => {
  // Deze opstelling heeft geen Supabase; dan valt er niets te mislukken
  // en hoort er geen reden terug te komen.
  const store = laadStore([team('onderzoek', 0)])
  const reden = await store.moveTeamGroup('__freelance__', -1)
  assert.equal(reden, null)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', '__freelance__', 'onderzoek', '__inactive__', '__overig__'])
})

test('een onbekende sectie geeft een reden in plaats van stilte', async () => {
  const store = laadStore([team('onderzoek', 0)])
  assert.match(await store.moveTeamGroup('bestaat-niet', -1), /niet in de lijst/i)
})

test('een nieuw team komt bij de bestaande volgorde, niet ervoor', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__freelance__', -1)
  const nieuw = await store.createTeamGroup('Editors')
  assert.ok(nieuw)
  assert.ok(namen(store.loadTeamSections()).includes('editors'))
})

test('een mislukte opslag zet de volgorde terug en zegt waarom', async () => {
  // Dit is het scenario waarin het eruitziet alsof de pijlen niets doen:
  // de lijst verspringt even, de opslag mislukt, en de eerstvolgende pull
  // zet alles terug — zonder uitleg.
  const store = laadStore([team('onderzoek', 0)], {
    uid: 'user-1',
    supabase: { from: () => ({ upsert: async () => ({ error: { message: 'kolom bestaat niet' } }) }) },
  })
  const voor = namen(store.loadTeamSections())

  const reden = await store.moveTeamGroup('__freelance__', -1)
  assert.match(reden ?? '', /niet opgeslagen/i, 'er komt een reden terug')
  assert.deepEqual(namen(store.loadTeamSections()), voor,
    'en de oude volgorde staat er weer, zodat je niet naar een leugen kijkt')
})

test('een gelukte opslag bewaart de nieuwe volgorde', async () => {
  const store = laadStore([team('onderzoek', 0)], {
    uid: 'user-1',
    supabase: { from: () => ({ upsert: async () => ({ error: null }) }) },
  })
  assert.equal(await store.moveTeamGroup('__freelance__', -1), null)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', '__freelance__', 'onderzoek', '__inactive__', '__overig__'])
})

test('Overig kan net zo goed omhoog als de rest', () => {
  // Hij stond altijd onderaan vastgepind, buiten de lijst om.
  const store = laadStore([team('onderzoek', 0)])
  assert.equal(store.canMoveTeamGroup('__overig__', -1), true)
  assert.equal(store.canMoveTeamGroup('__overig__', 1), false, 'onderaan houdt het op')
})

test('Overig omhoog verwisselt met Inactief team', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__overig__', -1)
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__yoko__', 'onderzoek', '__freelance__', '__overig__', '__inactive__'])
})

test('Overig is geen team dat je in de teamkeuze aangeboden krijgt', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroup('__overig__', -1)
  assert.deepEqual(namen(store.loadCustomTeamGroups()), ['onderzoek'])
})

test('een nieuw vast blok gooit een bestaande volgorde niet om', () => {
  // Overig kwam er later bij. Wie zijn secties al had gesorteerd, had
  // alle vier de blokken nog niet in de opslag staan — en met een
  // 'ken ik ze allemaal?'-check sloeg die hele volgorde dan terug naar
  // de standaard.
  const store = laadStore([
    team('__freelance__', 0), team('onderzoek', 1), team('__yoko__', 2), team('__inactive__', 3),
  ])
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__freelance__', 'onderzoek', '__yoko__', '__inactive__', '__overig__'],
    'de zelfgekozen volgorde blijft staan en het nieuwe blok komt erachter')
})

test('een sectie voor een andere zetten verschuift hem daarheen', async () => {
  // Dit is het verslepen van een chip op de to do's-pagina.
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroupBefore('__inactive__', '__yoko__')
  assert.deepEqual(namen(store.loadTeamSections()),
    ['__inactive__', '__yoko__', 'onderzoek', '__freelance__', '__overig__'])
})

test('naar achteren slepen kan net zo goed', async () => {
  const store = laadStore([team('onderzoek', 0)])
  await store.moveTeamGroupBefore('__yoko__', '__overig__')
  assert.deepEqual(namen(store.loadTeamSections()),
    ['onderzoek', '__freelance__', '__inactive__', '__yoko__', '__overig__'],
    'hij neemt de plek van het doel in; het doel schuift op')
})

test('op zichzelf laten vallen verandert niets', async () => {
  const store = laadStore([team('onderzoek', 0)])
  const voor = namen(store.loadTeamSections())
  assert.equal(await store.moveTeamGroupBefore('onderzoek', 'onderzoek'), null)
  assert.deepEqual(namen(store.loadTeamSections()), voor)
})

test('slepen naar een sectie die niet bestaat geeft een reden', async () => {
  const store = laadStore([team('onderzoek', 0)])
  assert.match(await store.moveTeamGroupBefore('onderzoek', 'bestaat-niet'), /niet in de lijst/i)
})

test('een mislukte opslag draait ook een sleep terug', async () => {
  const store = laadStore([team('onderzoek', 0)], {
    uid: 'user-1',
    supabase: { from: () => ({ upsert: async () => ({ error: { message: 'nee' } }) }) },
  })
  const voor = namen(store.loadTeamSections())
  assert.match(await store.moveTeamGroupBefore('__inactive__', '__yoko__') ?? '', /niet opgeslagen/i)
  assert.deepEqual(namen(store.loadTeamSections()), voor)
})
