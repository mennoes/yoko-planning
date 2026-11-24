import assert from 'node:assert/strict'
import test from 'node:test'
import { readBoardItems } from '../lib/boardItemReads.ts'

function database() {
  const rows = new Map([['a', { id: 'a', row_version: '1', notes: 'first' }], ['b', { id: 'b', row_version: '1', notes: 'second' }]])
  const reads = []
  const db = { from() {
    let columns, ids
    return {
      select(value) { columns = value; return this },
      eq() { return this }, is() { return this }, order() { return this },
      in(_, value) { ids = value; return this },
      then(resolve) {
        reads.push({ columns, ids })
        resolve({ data: [...rows.values()].filter(r => !ids || ids.includes(r.id)).map(r =>
          columns.startsWith('*') ? { ...r } : { id: r.id, row_version: r.row_version }) })
      },
    }
  } }
  return { db, rows, reads }
}

test('opening, five idle ticks, editing, deletion and account switch', async () => {
  const { db, rows, reads } = database()
  const pull = (user = 'first') => readBoardItems(db, 'test', user)
  assert.equal((await pull()).length, 2)
  for (let i = 0; i < 5; i++) assert.equal((await pull())[1].notes, 'second')
  assert.equal(reads.filter(q => q.columns.startsWith('*')).length, 1)
  rows.set('b', { id: 'b', row_version: '2', notes: 'edited' })
  assert.equal((await pull())[1].notes, 'edited')
  assert.deepEqual(reads.at(-1).ids, ['b'])
  rows.delete('a')
  assert.deepEqual((await pull()).map(r => r.id), ['b'])
  assert.equal(reads.at(-1).columns, 'id,row_version:xmin')
  await pull('second')
  assert.ok(reads.at(-1).columns.startsWith('*'))
})

test('overlapping board refreshes share the request and an unchanged board skips both tables', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const { default: ts } = await import('typescript')
  const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
  const source = store.slice(store.indexOf('const boardReads ='), store.indexOf('const STANDARD_FIELDS'))
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exported = {}, cache = new Map()
  let rpcCalls = 0, groupReads = 0, itemReads = 0, version = 'first'
  const db = {
    rpc: async () => { rpcCalls++; return { data: version } },
    from: () => ({ select() { return this }, eq() { return this }, is() { return this }, order() { groupReads++; return { data: [{ id: 'group' }] } } }),
  }
  runInNewContext(js, { exports: exported, supabase: db, getCurrentUserId: async () => 'user',
    localStorage: { getItem: k => cache.get(k) ?? null, setItem: (k,v) => cache.set(k,v) },
    key: b => b, dirtyKey: b => b + '-dirty', pulledKey: b => b + '-pulled', writeLastSync() {},
    window: { dispatchEvent() {} }, CustomEvent: class {}, readBoardItems: async () => { itemReads++; return [] } })
  await Promise.all([exported.pullBoardFromRemote('board'), exported.pullBoardFromRemote('board')])
  await exported.pullBoardFromRemote('board')
  assert.deepEqual([rpcCalls, groupReads, itemReads], [2, 1, 1])
  version = 'next'
  await exported.pullBoardFromRemote('board')
  assert.deepEqual([rpcCalls, groupReads, itemReads], [3, 2, 2])
})
