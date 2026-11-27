import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('background recovery checks stay infrequent while realtime remains enabled', () => {
  const comments = read('lib/commentsStore.ts')
  const notifications = read('components/NotificationBell.tsx')
  const planning = read('app/planning/page.tsx')
  const shell = read('components/AppShell.tsx')

  assert.match(comments, /on\('postgres_changes',[\s\S]*applyRemoteChange\)/)
  assert.match(comments, /30 \* 60_000/)
  assert.doesNotMatch(comments, /setInterval\(refreshVisible, 30_000\)/)
  assert.match(notifications, /30 \* 60_000/)
  assert.doesNotMatch(notifications, /setInterval\([^\n]*30_000/)
  assert.match(planning, /}, 5 \* 60_000\)/)
  assert.match(shell, /MIN_VISIBILITY_INTERVAL_MS = 15 \* 60 \* 1000/)
  assert.match(shell, /setInterval\(\(\) => tick\('interval'\), 15 \* 60 \* 1000\)/)
})

test('board group refresh requests only fields used by the client', () => {
  const boardStore = read('lib/boardStore.ts')
  assert.match(boardStore, /from\('board_groups'\)\.select\('id,name,color,collapsed,position'\)/)
})
