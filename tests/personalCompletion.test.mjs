import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'

function load(file, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  runInNewContext(js, { exports, console, URL, Request, Response, ...globals, require(id) {
    if (!(id in mocks)) throw new Error('Unexpected dependency ' + id)
    return mocks[id]
  } })
  return exports
}
const rules = load('../lib/personalCompletion.ts')
const { setPersonalCompletion } = load('../lib/personalCompletionServer.ts', {
  'node:crypto': { createHash }, './personalCompletion': rules,
})
const target = { parentItemId: 'project' }
function fakeDb() {
  const tables = {
    profiles: [{ user_id: 'u-menno', member_id: 'menno', name: 'Menno' }, { user_id: 'u-odette', member_id: 'odette', name: 'Odette' }, { user_id: 'u-other', member_id: 'other', name: 'Other' }],
    board_items: [{ id: 'project', board_id: 'yoko', group_id: 'work', name: 'Artwork', status: 'Working on...', owner_ids: ['menno', 'odette'], est_hours: 40,
      subitems: [{ id: 'sub', name: 'Animatie', ownerIds: ['menno', 'odette'], status: '' }], deleted_at: null }],
    board_groups: [{ id: 'work', deleted_at: null }],
    team_members: [{ id: 'menno', name: 'Menno' }, { id: 'odette', name: 'Odette' }], comments: [], notifications: [],
  }
  const db = { tables, fails: new Map(), reads: [], from(table) {
    const filters = []; let write; let one = false; let range
    const q = {
      select() { return q }, eq(k, v) { filters.push(r => r[k] === v); return q },
      is(k, v) { filters.push(r => r[k] === v); return q }, in(k, vals) { filters.push(r => vals.includes(r[k])); return q },
      order() { return q }, range(a, b) { range = [a, b]; return q },
      single() { one = true; return q }, maybeSingle() { one = true; return q },
      upsert(value, opts) { assert.equal(opts.ignoreDuplicates, true); write = Array.isArray(value) ? value : [value]; return q },
      async then(resolve, reject) { try {
        const failure = db.fails.get(table) ?? 0
        if (failure > 0) { db.fails.set(table, failure - 1); return resolve({ data: null, error: { message: 'offline' } }) }
        if (write) for (const row of write) if (!tables[table].some(r => r.id === row.id)) tables[table].push(structuredClone(row))
        db.reads.push(table)
        let rows = tables[table].filter(r => filters.every(f => f(r)))
        if (range) rows = rows.slice(range[0], range[1] + 1)
        resolve({ data: structuredClone(one ? rows[0] ?? null : rows), error: null })
      } catch (e) { reject(e) } },
    }
    return q
  } }
  return db
}

test('only self completes; project status, hours and other owners remain unchanged', async () => {
  const db = fakeDb(); const before = structuredClone(db.tables.board_items)
  const result = await setPersonalCompletion(db, 'u-menno', target, true, null)
  assert.deepEqual(db.tables.board_items, before)
  assert.equal(rules.completionState([result.comment], target, 'menno').done, true)
  assert.equal(rules.completionState([result.comment], target, 'odette'), undefined)
  assert.match(result.comment.thread[0].body, /Menno.*afgerond.*Artwork/)
  assert.match(result.comment.thread[0].body, /@Odette/)
  assert.equal(db.tables.notifications.length, 1)
  assert.equal(db.tables.notifications[0].recipient_id, 'odette')
  assert.match(db.tables.notifications[0].href, /projects\/yoko\?drawer=project/)
})
test('retries and simultaneous double clicks create one message/notification and retain read state', async () => {
  const db = fakeDb()
  await Promise.all([setPersonalCompletion(db, 'u-menno', target, true, null), setPersonalCompletion(db, 'u-menno', target, true, null)])
  db.tables.notifications[0].read = true
  await setPersonalCompletion(db, 'u-menno', target, true, null)
  assert.equal(db.tables.comments.length, 1); assert.equal(db.tables.notifications.length, 1)
  assert.equal(db.tables.notifications[0].read, true)
})
test('different owners can finish concurrently without overwriting one another', async () => {
  const db = fakeDb()
  const result = await Promise.all([setPersonalCompletion(db, 'u-menno', target, true, null), setPersonalCompletion(db, 'u-odette', target, true, null)])
  const comments = result.map(r => r.comment)
  assert.equal(rules.completionState(comments, target, 'menno').done, true)
  assert.equal(rules.completionState(comments, target, 'odette').done, true)
  assert.equal(db.tables.comments.length, 2)
  assert.equal(db.tables.board_items[0].status, 'Working on...')
})
test('reopen only your own state; stale opposite action is rejected', async () => {
  const db = fakeDb()
  const done = await setPersonalCompletion(db, 'u-menno', target, true, null)
  await assert.rejects(setPersonalCompletion(db, 'u-menno', target, false, null), /intussen gewijzigd/)
  const open = await setPersonalCompletion(db, 'u-menno', target, false, done.comment.id)
  assert.equal(rules.completionState([open.comment, done.comment], target, 'menno').done, false)
  assert.match(open.comment.thread[0].body, /heropend/)
  const doneAgain = await setPersonalCompletion(db, 'u-menno', target, true, open.comment.id)
  assert.notEqual(doneAgain.comment.id, done.comment.id)
})
test('unassigned people, missing profiles, deleted items/groups and globally Done are rejected', async () => {
  for (const mutate of [
    db => { db.tables.board_items[0].owner_ids = ['odette'] },
    db => { db.tables.profiles = [] },
    db => { db.tables.board_items[0].deleted_at = 'today' },
    db => { db.tables.board_groups[0].deleted_at = 'today' },
    db => { db.tables.board_items[0].status = 'Done' },
  ]) {
    const db = fakeDb(); mutate(db)
    await assert.rejects(setPersonalCompletion(db, 'u-menno', target, true, null))
    assert.equal(db.tables.comments.length, 0); assert.equal(db.tables.notifications.length, 0)
  }
})
test('subitems use stable identities; parent and other subitems do not become personally Done', async () => {
  const db = fakeDb(); const subTarget = { ...target, subitemId: 'sub' }
  const result = await setPersonalCompletion(db, 'u-menno', subTarget, true, null)
  assert.equal(result.comment.contextId, 'board-item:sub')
  assert.equal(rules.completionState([result.comment], target, 'menno'), undefined)
  assert.equal(rules.completionState([result.comment], subTarget, 'menno').done, true)
  assert.match(db.tables.notifications[0].href, /subitem=sub/)
  assert.match(result.comment.thread[0].body, /Animatie \(bij Artwork\)/)
  db.tables.board_items[0].subitems[0].ownerIds = ['odette']
  await assert.rejects(setPersonalCompletion(db, 'u-menno', subTarget, false, result.comment.id), /eigen toegewezen/)
})
test('subitems inherit empty assignments; notify other task and parent owners only once', async () => {
  const db = fakeDb(); db.tables.board_items[0].subitems[0].ownerIds = ['unassigned']
  await setPersonalCompletion(db, 'u-menno', { ...target, subitemId: 'sub' }, true, null)
  assert.equal(db.tables.notifications.length, 1)
  assert.equal(db.tables.notifications[0].recipient_id, 'odette')
})
test('failed status save sends no notification; notification failure is explicit and retryable', async () => {
  const db = fakeDb(); db.fails.set('comments', 1)
  await assert.rejects(setPersonalCompletion(db, 'u-menno', target, true, null))
  assert.equal(db.tables.comments.length, 0); assert.equal(db.tables.notifications.length, 0)
  db.fails.set('notifications', 3)
  const saved = await setPersonalCompletion(db, 'u-menno', target, true, null)
  assert.equal(saved.notificationError, true)
  assert.equal(db.tables.comments.length, 1)
  const retried = await setPersonalCompletion(db, 'u-menno', target, true, null)
  assert.equal(retried.notificationError, false)
  assert.equal(db.tables.comments.length, 1); assert.equal(db.tables.notifications.length, 1)
})
test('Home and To do shared selector uses personal Done and supports reopening despite stale local flags', async () => {
  const db = fakeDb(); const done = await setPersonalCompletion(db, 'u-menno', target, true, null)
  let comments = [done.comment]
  const groups = [{ name: 'Werk', items: [{ id: 'project', name: 'Artwork', status: '', ownerIds: ['menno', 'odette'], startDate: '2099-01-01', endDate: '2099-02-01' }] }]
  const mocks = {
    './boardStore': { loadGroups: board => board === 'yoko' ? groups : [] },
    './workloadCategory': { isVrijTitle: () => false, loadCategoryOverrides: () => ({}) },
    './commentsStore': { loadAllComments: () => comments }, './personalCompletion': rules,
  }
  for (const board of ['yoko', 'pnp', 'nederland', 'vlaanderen', 'dienjaar']) mocks[`@/data/boards/${board}.json`] = { groups: [] }
  const api = load('../lib/todoProjectSeed.ts', mocks, { window: { localStorage: { getItem: () => null } } })
  assert.equal(api.mergeMemberTodoItems([], 'menno')[0].done, true)
  assert.equal(api.mergeMemberTodoItems([], 'odette')[0].done, false)
  const open = await setPersonalCompletion(db, 'u-menno', target, false, done.comment.id)
  comments = [done.comment, open.comment]
  const stale = [{ id: 'task', text: 'Artwork', done: true, projectRef: { board: 'yoko', itemId: 'project' } }]
  assert.equal(api.mergeMemberTodoItems(stale, 'menno')[0].done, false)
  groups[0].items[0].status = 'Done'
  assert.equal(api.mergeMemberTodoItems(stale, 'menno').length, 0)
  assert.equal(api.mergeMemberTodoItems([], 'odette').length, 0)
})
test('API rejects unauthenticated and malformed requests before doing any writes', async () => {
  let calls = 0
  const { POST } = load('../app/api/items/personal-completion/route.ts', {
    '@/lib/supabaseAdmin': { supabaseAdmin: { auth: { getUser: async () => ({ data: { user: { id: 'real-user' } }, error: null }) } } },
    '@/lib/personalCompletionServer': { setPersonalCompletion: async () => { calls++; return {} }, CompletionError: Error },
  })
  assert.equal((await POST(new Request('http://local/', { method: 'POST' }))).status, 401)
  const request = body => new Request('http://local/', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(body) })
  assert.equal((await POST(request({ parentItemId: 'project', done: 'yes', expectedEventId: null }))).status, 400)
  assert.equal((await POST(request(null))).status, 400)
  assert.equal(calls, 0)
})
