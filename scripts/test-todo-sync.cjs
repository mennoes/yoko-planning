const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = ts.transpile(fs.readFileSync('lib/todosStore.ts', 'utf8'), { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS })
const storage = new Map(), calls = []
const sections = [{ id: 'a', title: 'A', emoji: '', items: [{ id: 't', text: 'Task', done: false }] }, { id: 'b', title: 'B', emoji: '', items: [] }]
let fail = false, block, release
const client = { from(table) {
  return {
    update(row) { return { is() { return this }, async eq(_, id) { if (block) await block; calls.push({ table, action: 'update', row, id }); return { error: fail ? new Error('offline') : null } } } },
    upsert(row) { calls.push({ table, action: 'insert', row }); return Promise.resolve({ error: null }) },
    delete() { return { eq(_, id) { calls.push({ table, action: 'delete', id }); return Promise.resolve({ error: null }) } } },
  }
} }
function boot() {
  const c = { exports: {}, crypto: require('node:crypto').webcrypto, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    window: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }, CustomEvent: class {}, setTimeout: () => 1, clearTimeout() {},
    require: name => name === './supabase' ? { supabase: client } : { getCurrentUserId: async () => 'user' },
  }
  vm.createContext(c); vm.runInContext(source, c); return c.exports
}
async function run() {
  let api = boot()
  const reordered = [sections[1], sections[0]]
  let diff = api.diffTodoRows(sections, reordered)
  assert.equal(diff.length, 2); assert.ok(diff.every(x => x.table === 'todo_sections' && Object.keys(x.row).join(',') === 'id,position'))
  const done = structuredClone(sections); done[0].items[0].done = true
  diff = api.diffTodoRows(sections, done); assert.equal(diff.length, 1); assert.equal(diff[0].row.done, true)
  assert.equal(api.diffTodoRows(done, sections)[0].row.done, false)
  assert.equal(api.diffTodoRows(sections, sections).length, 0)
  assert.equal(api.mergeSections(sections, reordered)[0].id, 'b')
  assert.equal(api.mergeSections(sections, [sections[1]]).length, 1)
  api.cacheRemoteSections(sections)
  block = new Promise(r => release = r)
  api.saveSections(done)
  await new Promise(r => setImmediate(r))
  api.saveSections(sections)
  release(); block = null
  await api.pushToRemote()
  assert.deepEqual(calls.filter(c => 'done' in c.row).map(c => c.row.done), [true, false])
  assert.equal(JSON.parse(storage.get('yoko-todos-outbox-v2')).length, 0)
  fail = true; api.saveSections(done); assert.equal(await api.pushToRemote(), false)
  assert.ok(JSON.parse(storage.get('yoko-todos-outbox-v2')).length)
  api = boot(); fail = false; assert.equal(await api.pushToRemote(), true)
  assert.equal(JSON.parse(storage.get('yoko-todos-outbox-v2')).length, 0)
  const removed = structuredClone(done); removed[0].items = []
  api.saveSections(removed); await api.pushToRemote()
  assert.equal(calls.at(-1).row.project_ref._deleted, true)
  console.log('PASS: shared order, field-only writes, reopen, delete, serialized rapid edits, offline queue and refresh retry')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
