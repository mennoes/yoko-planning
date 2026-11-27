import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')
const table = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

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

test('ook een Done-wijziging op een subitem komt in de herstelgeschiedenis', () => {
  assert.match(table, /if \(before\.status !== after\.status\)/)
  assert.match(table, /field: 'status', boardId, itemName: `\$\{parent\.name\} › \$\{before\.name\}`/)
  assert.match(table, /before: before\.status, after: after\.status/)
})

test('een dirty cache uit een vorige mobiele sessie kan nieuwere remote velden niet terugzetten', () => {
  assert.match(store, /function dirtySessionKey\(boardName: string\)/)
  assert.match(store, /sessionStorage\.setItem\(dirtySessionKey\(boardName\), dirtyAt\)/)
  assert.match(store, /preferRemoteConflicts: !dirtyFromCurrentSession/)
  assert.match(store, /const remoteWinsConflicts = preferRemoteConflicts/)
})

test('Planning toont geen lokale cache voordat een geforceerde online refresh klaar is', () => {
  assert.match(planning, /initialBoardSyncDone/)
  assert.match(planning, /pullBoardFromRemote\(name, \{ force: true \}\)/)
  assert.match(planning, /Planning bijwerken…/)
  assert.match(planning, /addEventListener\('pageshow', onPageShow\)/)
  assert.match(store, /if \(!force && typeof signature === 'string'/)
})
