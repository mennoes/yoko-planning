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
