import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
const preview = readFileSync(new URL('../components/AgendaSnapshotPreview.tsx', import.meta.url), 'utf8')

test('agenda recovery requires a preview before restoring a snapshot', () => {
  assert.match(sidebar, /setPreviewSnapshot\(snap\)/)
  assert.match(sidebar, />Voorbeeld<\/button>/)
  assert.doesNotMatch(sidebar, /onClick=\{\(\) => void restoreSnapshot\(snap\)\}/)
})

test('snapshot preview is read-only and exposes restore only from the preview', () => {
  assert.match(preview, /Recoveryvoorbeeld · niets kan hier worden gewijzigd/)
  assert.match(preview, /Deze versie herstellen/)
  assert.match(preview, /Zoek in deze oude agenda/)
  assert.match(preview, /Subitems/)
})

test('snapshot preview loads only the selected snapshot payload', () => {
  assert.match(preview, /from\('board_snapshots'\)\.select\('data'\)\.eq\('id', snapshot\.id\)\.single\(\)/)
})
