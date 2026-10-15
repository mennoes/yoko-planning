import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../app/api/snapshots/merge-missing-subitems/route.ts', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../components/BoardRecoveryDrawer.tsx', import.meta.url), 'utf8')

test('subitem recovery scans history instead of trusting one snapshot', () => {
  assert.match(route, /\.limit\(100\)/)
  assert.match(route, /for \(const snapshot of snapshotRows\)/)
  assert.match(route, /historyByItemId/)
  assert.doesNotMatch(route, /\.limit\(1\)/)
})

test('agenda recovery offers one safe history scan without choosing a snapshot', () => {
  assert.match(drawer, /Zoek en herstel ontbrekende afspraken/)
  assert.match(drawer, /body: JSON\.stringify\(\{ boardId \}\)/)
  assert.match(drawer, /bewust verwijderde Google-afspraken komen niet terug/)
})

test('subitem recovery deduplicates recurring occurrences and respects intentional deletes', () => {
  assert.match(route, /function subIdentity/)
  assert.match(route, /sourceItemId/)
  assert.match(route, /externalLink/)
  assert.match(route, /dismissedInstanceIds/)
  assert.match(route, /dismissed\.has\(sub\.id\)/)
  assert.match(route, /dismissed\.has\(sub\.sourceItemId\)/)
})

test('recovery also follows earlier parents of the same recurring meeting series', () => {
  assert.match(route, /historicalItemsByTitle/)
  assert.match(route, /normalizedTitle\(cur\.name\)/)
  assert.match(route, /ownersOverlap\(cur, alias\)/)
  assert.match(route, /< earliestCurrentDate/)
  assert.match(route, /uniqueSnapshotSubs/)
  assert.match(route, /if \(!uniqueSnapshotSubs\.has\(key\)\)/)
})
