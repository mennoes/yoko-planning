import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const table = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')

test('Google meetings expose a clear cross-agenda drag affordance', () => {
  assert.match(table, /yoko-board-item-drag-start/)
  assert.match(table, /Sleep deze Google-meeting naar een andere agenda links/)
  assert.match(table, /item\.source === 'google' \? 0\.7 : 0/)
})

test("Agenda's opens automatically and exposes destination rows while dragging", () => {
  assert.match(sidebar, /window\.addEventListener\('yoko-board-item-drag-start', onStart\)/)
  assert.match(sidebar, /setOpen\(true\)/)
  assert.match(sidebar, /hierheen/)
})

test('moved Google meetings land in a Meetings group', () => {
  assert.match(store, /movedItem\.source === 'google' \? tgtGroups\.findIndex\(isMeetingsGroup\) : 0/)
  assert.match(store, /name:\s+movedItem\.source === 'google' \? 'Meetings' : 'Lopende projecten'/)
  assert.match(store, /updatedTarget\.find\(group => group\.id === targetGroupId\)/)
})

test('manual Google moves are persisted as placement locks', () => {
  assert.match(store, /googlePlacementLocked: true/)
  assert.match(store, /movePatch\.extra = \{ \.\.\.extra, googlePlacementLocked: true \}/)
  assert.match(table, /rawItem\?\.source === 'google' \? \{ \.\.\.rawItem, googlePlacementLocked: true \}/)
})

test('an item can be nested into a parent in another group', () => {
  assert.doesNotMatch(table, /if \(data\.fromGroupId !== group\.id\) return/)
})
