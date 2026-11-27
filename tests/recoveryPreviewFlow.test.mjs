import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const drawer = readFileSync(new URL('../components/BoardRecoveryDrawer.tsx', import.meta.url), 'utf8')
const preview = readFileSync(new URL('../components/AgendaSnapshotPreview.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/snapshots/merge-missing-subitems/route.ts', import.meta.url), 'utf8')

test('recovery actions open a read-only agenda preview before changing data', () => {
  assert.match(drawer, /setPreview\(\{ mode: 'items', snapshot: summaryFor\(s\) \}\)/)
  assert.match(drawer, /setPreview\(\{ mode: 'subs', snapshot: summaryFor\(s\) \}\)/)
  assert.match(drawer, /setPreview\(\{ mode: 'hours', snapshot: summaryFor\(s\) \}\)/)
  assert.match(drawer, /<AgendaSnapshotPreview/)
  assert.match(drawer, /onRestore=\{applyPreviewAction\}/)
  assert.match(drawer, /Bekijk · items/)
  assert.match(drawer, /Bekijk · subs/)
  assert.match(drawer, /Bekijk · uren/)
})

test('automatic missing-appointment scan returns the snapshot used for preview', () => {
  assert.match(route, /usedSnapshotId: snapshotRows\[0\]\.id/)
  assert.match(drawer, /mode: 'missing'/)
  assert.match(drawer, /Voeg ontbrekende afspraken toe/)
})

test('primary recovery buttons keep readable dark text on the light blue accent', () => {
  assert.match(drawer, /background: 'var\(--accent\)', color: '#172033'/)
  assert.match(preview, /background: 'var\(--accent\)', color: '#172033'/)
})
