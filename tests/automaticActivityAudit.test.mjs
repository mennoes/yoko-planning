import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../app/api/maintenance/sync-masterplanning/route.ts', import.meta.url), 'utf8')
const helper = readFileSync(new URL('../lib/systemItemActivity.ts', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../components/BoardActivityDrawer.tsx', import.meta.url), 'utf8')
const history = readFileSync(new URL('../components/ItemHistory.tsx', import.meta.url), 'utf8')
const planner = readFileSync(new URL('../components/ItemPlanner.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('every automatic Nederland masterplanning change is attributed to ChatGPT', () => {
  assert.match(route, /actor: 'chatgpt'/)
  assert.match(route, /wijzigde automatisch de naam/)
  assert.match(route, /wijzigde automatisch de timeline/)
  assert.match(route, /wijzigde automatisch de deadline/)
  assert.match(route, /wijzigde automatisch de contactpersoon/)
  assert.match(route, /wijzigde automatisch de uren/)
  assert.match(route, /maakte automatisch dit item aan/)
  assert.match(route, /logSystemItemActivities\(supabaseAdmin, activity\)/)
})

test('system activity uses the shared append-only item history with before and after values', () => {
  assert.match(helper, /from\('activity'\)\.insert/)
  assert.match(helper, /target: `board_item:\$\{entry\.itemId\}`/)
  assert.match(helper, /before: entry\.before/)
  assert.match(helper, /after: entry\.after/)
  assert.match(helper, /actorName: actor\.name/)
})

test('board and item history show the named automatic actor instead of Iemand', () => {
  assert.match(drawer, /e\.meta\?\.actorName/)
  assert.match(drawer, /e\.meta\?\.actorType === 'ai'/)
  assert.match(history, /a\.meta\?\.actorName/)
  assert.match(history, /a\.meta\?\.actorType === 'ai'/)
})

test('items generated from an AI proposal retain ChatGPT as the creation actor, not as project owner', () => {
  assert.match(planner, /item\.auditActor = 'chatgpt'/)
  assert.doesNotMatch(planner, /ownerIds.*chatgpt|chatgpt.*ownerIds/)
  assert.match(board, /item\.auditActor === 'chatgpt'/)
  assert.match(board, /actorName: 'ChatGPT', actorType: 'ai', source: 'item-planner'/)
})
