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
