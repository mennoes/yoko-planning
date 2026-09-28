const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = ts.transpile(fs.readFileSync('lib/boardStore.ts', 'utf8'), { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS })
const storage = new Map(), writes = []
let active = 0, maxActive = 0, onRead, fail = false
const groupRow = { id: 'g', name: 'Meetings', board_id: 'yoko' }
const client = { from(table) {
  let action = 'read', rows, fields
  const q = {
    select(f) { fields = f; return q }, eq() { return q }, is() { return q }, order() { return q }, in() { return q },
    upsert(r) { action = 'write'; rows = r; return q },
    async then(resolve, reject) {
      try {
        if (action === 'write') {
          active++; maxActive = Math.max(maxActive, active)
          await new Promise(r => setTimeout(r, 5))
          active--; if (table === 'board_items') writes.push(rows)
        } else if (table === 'board_groups' && onRead) { const f = onRead; onRead = null; f() }
        return resolve({ error: fail ? { message: 'offline' } : null, data: action === 'write' ? [] : table === 'board_groups' ? [groupRow] : fields === 'id, board_id' ? [] : [{ id: 'i', group_id: 'g', name: 'Meeting', status: '', owner_ids: [] }] })
      } catch (e) { return reject(e) }
    },
  }; return q
} }
const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }
const context = { exports: {}, console, localStorage, window: { localStorage, dispatchEvent() {} }, CustomEvent: class {},
  require: name => name === './supabase' ? { supabase: client } : name === './sync' ? { getCurrentUserId: async () => 'user' } : { normalizeTitle: s => s, getBoardIds: () => ['yoko'] },
}
vm.createContext(context); vm.runInContext(source, context)
const api = context.exports
const groups = status => [{ id: 'g', name: 'Meetings', items: [{ id: 'i', name: 'Meeting', ownerIds: [], status }] }]
async function run() {
  storage.set('yoko-board-yoko', JSON.stringify(groups('')))
  api.saveGroups('yoko', groups('Done'))
  api.saveGroups('yoko', groups('Working on...'))
  await api.pushBoardToRemote('yoko', groups('Working on...'))
  assert.equal(maxActive, 1, 'writes must be serialized')
  assert.equal(writes.at(-1)[0].status, 'Working on...')
  storage.delete('yoko-board-yoko-dirty')
  onRead = () => { storage.set('yoko-board-yoko', JSON.stringify(groups('Done'))); storage.set('yoko-board-yoko-dirty', '1') }
  assert.equal(await api.pullBoardFromRemote('yoko'), false)
  assert.equal(JSON.parse(storage.get('yoko-board-yoko'))[0].items[0].status, 'Done', 'late read must not erase checkmark')
  fail = true
  assert.equal(await api.pullBoardFromRemote('yoko'), false)
  assert.equal(storage.get('yoko-board-yoko-dirty'), '1', 'old offline edits must not expire')
  console.log('PASS: serialized saves, stale-read protection, durable offline edits')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
