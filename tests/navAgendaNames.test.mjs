import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Hernoem je een agenda op het ene apparaat, dan moet die naam op het
// andere apparaat ook verschijnen. De naam staat gedeeld in Supabase
// (boards.name); het menu bewaart per apparaat z'n eigen volgorde en
// labels in localStorage. reconcileAgendaSections hoort die twee bij
// elkaar te brengen: de database wint over de lokale kopie.
function laad(opslag = {}) {
  const source = readFileSync(new URL('../lib/navStore.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const kaart = new Map(Object.entries(opslag))
  const exports = {}
  const localStorage = {
    getItem: k => kaart.get(k) ?? null,
    setItem: (k, v) => kaart.set(k, v),
    removeItem: k => kaart.delete(k),
  }
  runInNewContext(js, {
    exports, localStorage, JSON, Date, Object, Array, String, Number, Boolean, Set, Map,
    window: { localStorage, dispatchEvent() {} },
    CustomEvent: class {},
    require(id) {
      if (id === './demoRoute' || id === './demoFixtures') return { isOnDemoRoute: () => false, isDemoPath: () => false }
      throw new Error(`Onverwachte afhankelijkheid ${id}`)
    },
  })
  return exports
}

/** Het menu zoals het op een ander apparaat in localStorage staat. */
const menuMet = labels => ([{
  id: 'agenda', type: 'projects', label: "Agenda's", collapsed: false,
  items: labels.map(([id, label]) => ({ id, label, href: `/projects/${id}` })),
}])

const borden = namen => namen.map(([id, name]) => ({ id, name, color: '#579bfc' }))

test('een elders hernoemde agenda krijgt die naam ook in dit menu', () => {
  const nav = laad()
  const uit = nav.reconcileAgendaSections(
    menuMet([['pnp', 'PnP'], ['dienjaar', 'Dienjaar']]),
    borden([['pnp', 'U Studio'], ['dienjaar', 'Itorium']]),
  )
  const labels = Array.from(uit[0].items, i => i.label)
  assert.deepEqual(labels, ['U Studio', 'Itorium'])
})

test('de eigen volgorde blijft staan', () => {
  const nav = laad()
  const uit = nav.reconcileAgendaSections(
    menuMet([['dienjaar', 'Dienjaar'], ['pnp', 'PnP']]),
    borden([['pnp', 'U Studio'], ['dienjaar', 'Itorium']]),
  )
  const ids = Array.from(uit[0].items, i => i.href)
  assert.deepEqual(ids, ['/projects/dienjaar', '/projects/pnp'], 'de volgorde van dit apparaat blijft')
})

test('een agenda die hier nog niet in het menu staat komt erbij', () => {
  const nav = laad()
  const uit = nav.reconcileAgendaSections(
    menuMet([['pnp', 'U Studio']]),
    borden([['pnp', 'U Studio'], ['nieuw', 'Verse agenda']]),
  )
  const labels = Array.from(uit[0].items, i => i.label)
  assert.deepEqual(labels, ['U Studio', 'Verse agenda'])
})

test('ook met een verborgen agenda komt de nieuwe naam door', () => {
  // metadataChanged vergeleek de GEFILTERDE lijst op index met de
  // ONGEFILTERDE. Zodra er iets verborgen is schuiven die indexen, en
  // dan kan de vergelijking 'er is niets veranderd' zeggen terwijl een
  // naam wel degelijk is gewijzigd — met een oude naam in het menu tot
  // gevolg.
  const nav = laad({ 'yoko-hidden-agendas-v1': JSON.stringify(['yoko']) })
  const uit = nav.reconcileAgendaSections(
    menuMet([['yoko', 'yoko'], ['pnp', 'PnP']]),
    borden([['yoko', 'yoko'], ['pnp', 'U Studio']]),
  )
  const labels = Array.from(uit[0].items, i => i.label)
  assert.deepEqual(labels, ['U Studio'], 'de verborgen agenda is weg én PnP heet nu U Studio')
})

test('een menu-item zonder bord blijft met rust gelaten', () => {
  const nav = laad()
  const uit = nav.reconcileAgendaSections(
    menuMet([['pnp', 'U Studio'], ['los', 'Los item']]),
    borden([['pnp', 'U Studio']]),
  )
  const labels = Array.from(uit[0].items, i => i.label)
  assert.deepEqual(labels, ['U Studio', 'Los item'])
})
