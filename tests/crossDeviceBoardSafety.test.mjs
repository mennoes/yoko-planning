import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')

test('een apparaat zonder remote baseline overschrijft geen bestaande online rijen', () => {
  assert.match(store, /if \(!localStorage\.getItem\(pulledKey\(boardName\)\)\)/)
  assert.match(store, /baselineSerialized\.has\(id\) \|\| !storedById\.has\(id\)/)
})

test('een mislukte pull start nooit een blinde push van de lokale cache', () => {
  assert.doesNotMatch(shell, /if \(!ok\)[\s\S]{0,300}pushBoardToRemote/)
  assert.match(shell, /await pullBoardFromRemote\(b\)/)
})

test('subitem-status en timelines worden na opslaan teruggelezen en bevestigd', () => {
  assert.match(store, /notes, subitems, extra/)
  assert.match(store, /'notes', 'subitems'/)
})

test('sluiten waarschuwt zolang een agenda-save nog niet online bevestigd is', () => {
  assert.match(shell, /addEventListener\('beforeunload', warnForPendingBoardSave\)/)
  assert.match(shell, /key\.endsWith\('-dirty'\)/)
  assert.match(shell, /event\.returnValue = ''/)
})
