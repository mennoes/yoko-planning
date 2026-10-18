import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Nagebootste browseromgeving + database, zodat we de echte
// renameBoard-logica kunnen doorlopen zonder Supabase.
function load({ updateResult, upsertError = null }) {
  const source = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText

  const store = new Map()
  const calls = { updates: [], upserts: [], fetches: 0 }
  const localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  }
  const supabase = {
    from() {
      return {
        update(patch) {
          const chain = {
            eq() { return chain },
            select() {
              calls.updates.push(patch)
              return Promise.resolve(Array.isArray(updateResult) ? (updateResult.shift() ?? { data: [], error: null }) : updateResult)
            },
          }
          return chain
        },
        upsert(row) { calls.upserts.push(row); return Promise.resolve({ error: upsertError }) },
      }
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  }
  const exports = {}
  runInNewContext(js, {
    exports, module: { exports },
    require: name => ({
      './supabase': { supabase },
      './sync': { getCurrentUserId: async () => 'user-1' },
      './demoFixtures': { isOnDemoRoute: () => false, notifyDemoBlocked: () => {}, DEMO_BOARD_IDS: [] },
      './boards': {},
    })[name] ?? {},
    localStorage,
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    console, Date, JSON, Math, Set, Map, Number, Promise, Array, Object, String, Boolean, Error, fetch: async () => { calls.fetches++; throw new Error('geen server') },
  })
  // Eén bord in de cache zetten via de publieke API.
  localStorage.setItem('yoko-boards-registry', JSON.stringify([
    { id: 'vlaanderen', name: 'Vlaanderen', emoji: '📋', color: '#ff7a00', columns: [] },
  ]))
  return { registry: exports, calls, nameNow: () => JSON.parse(localStorage.getItem('yoko-boards-registry')).find(b => b.id === 'vlaanderen')?.name }
}

test('hernoemen schrijft rechtstreeks naar de boards-tabel', async () => {
  const { registry, calls, nameNow } = load({ updateResult: { data: [{ id: 'vlaanderen' }], error: null } })
  assert.equal(await registry.renameBoard('vlaanderen', 'Vlaanderen 2'), null)
  assert.equal(calls.updates.length, 1)
  assert.equal(calls.updates[0].name, 'Vlaanderen 2')
  // Alleen de naam — kolommen en kleur van een collega blijven intact.
  assert.deepEqual(Object.keys(calls.updates[0]).sort(), ['name', 'updated_at'])
  assert.equal(nameNow(), 'Vlaanderen 2')
})

test('bestond de rij nog niet, dan wordt die alsnog aangemaakt', async () => {
  // Dit was het geval waarin de naam 'meteen terugsprong': de route gaf
  // 404 en de client rolde terug.
  const { registry, calls, nameNow } = load({ updateResult: { data: [], error: null } })
  assert.equal(await registry.renameBoard('vlaanderen', 'Vlaanderen 2'), null)
  assert.equal(calls.upserts.length, 1)
  assert.equal(calls.upserts[0].name, 'Vlaanderen 2')
  assert.equal(nameNow(), 'Vlaanderen 2')
})

test('mislukt alles, dan komt de oude naam terug mét reden', async () => {
  const { registry, nameNow } = load({
    updateResult: { data: null, error: { message: 'permission denied for table boards' } },
  })
  const reason = await registry.renameBoard('vlaanderen', 'Vlaanderen 2')
  assert.match(reason ?? '', /permission denied|geweigerd|server/i)
  assert.equal(nameNow(), 'Vlaanderen')
})

test('een mislukte hernoeming blijft in beeld staan bij het invoerveld', () => {
  const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
  // Een toast is te makkelijk te missen: je ziet de naam terugspringen
  // zonder te weten waarom. De reden blijft nu onder het veld staan en
  // het veld blijft open met wat je typte.
  assert.match(sidebar, /const \[renameError, setRenameError\] = useState<\{ id: string; message: string \} \| null>\(null\)/)
  assert.match(sidebar, /setRenameError\(\{ id, message: reason \}\)\n\s+setEditingItemId\(id\)/)
  assert.match(sidebar, /role="alert"/)
  // Menu-items zonder agenda erachter zeggen dat meteen, in plaats van
  // stilletjes alleen lokaal te hernoemen.
  assert.match(sidebar, /Dit menu-item hoort niet bij een agenda\./)
})

test('een ontbrekende updated_at-kolom blokkeert het opslaan niet meer', () => {
  const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../app/api/boards/rename/route.ts', import.meta.url), 'utf8')
  const migration = readFileSync(new URL('../supabase/0040_boards_updated_at.sql', import.meta.url), 'utf8')
  // Dit was de echte oorzaak: PostgREST weigert de hele schrijfactie als
  // de kolom niet bestaat ("Could not find the 'updated_at' column of
  // 'boards' in the schema cache"), dus ook de server-route faalde altijd.
  assert.match(registry, /function isMissingUpdatedAt/)
  assert.match(registry, /function withStamp/)
  assert.match(registry, /boardsUpdatedAtSupported = false/)
  // Alle drie de schrijfpaden vangen 'm op: hernoemen, upsert en seeden.
  assert.equal((registry.match(/isMissingUpdatedAt\(/g) ?? []).length, 4)
  assert.match(route, /error\.code === 'PGRST204' \|\| \/updated_at\/\.test\(error\.message \?\? ''\)/)
  assert.match(migration, /add column if not exists updated_at timestamptz/)
})

test('zonder updated_at-kolom slaat hij alsnog op, zonder tijdstempel', async () => {
  // Precies de melding uit de praktijk. De eerste poging bevat de kolom
  // en wordt geweigerd; de tweede gaat zonder en slaagt.
  const { registry, calls, nameNow } = load({
    updateResult: [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'updated_at' column of 'boards' in the schema cache" } },
      { data: [{ id: 'vlaanderen' }], error: null },
    ],
  })
  assert.equal(await registry.renameBoard('vlaanderen', 'Vlaanderen 2'), null)
  assert.equal(calls.updates.length, 2)
  assert.ok('updated_at' in calls.updates[0])
  assert.deepEqual(Object.keys(calls.updates[1]), ['name'])
  assert.equal(nameNow(), 'Vlaanderen 2')
})
