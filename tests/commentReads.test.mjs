import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('parallel opens share a read, idle checks omit bodies and a single edit fetches one thread', async () => {
  const row = id => ({ id, version: '1', context_id: 'test', thread: [], created_at: '2026-11-24' })
  let rows = [row('a'), row('b')]
  const reads = []
  const db = { from: () => ({ select(columns) {
    return {
      order() { return this },
      range() { reads.push(columns); return { data: rows.map(r => columns.startsWith('*') ? { ...r } : { id: r.id, version: r.version }) } },
      in(_, ids) { reads.push([...ids]); return { data: rows.filter(r => ids.includes(r.id)) } },
    }
  } }) }
  const source = readFileSync(new URL('../lib/commentsStore.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}, store = new Map()
  runInNewContext(code, { exports, require: name => name === './sync' ? { getCurrentUserId: async () => 'user' } : { supabase: db },
    window: { dispatchEvent() {} }, CustomEvent: class {}, localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) } })
  await Promise.all([exports.pullCommentsAll(), exports.pullCommentsAll()])
  await exports.pullCommentsAll()
  rows = [{ ...row('b'), version: '2', quote: 'edited' }]
  await exports.pullCommentsAll()
  assert.deepEqual(reads, ['*,version:xmin','id,version:xmin','id,version:xmin',['b']])
  assert.equal(exports.loadAllComments().length, 1)
  assert.equal(exports.loadComment('b').quote, 'edited')
})
