import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const start = source.indexOf('function BoardGroupSection')
const end = source.indexOf('// ─── BoardTable', start)
const groupSection = source.slice(start, end > start ? end : undefined)

test('agenda columns drag from the space beside the editable name', () => {
  assert.match(groupSection, /draggable=\{!isMobile\}/)
  assert.match(groupSection, /onMoveColumn\(sourceKey, col\.key, side\)/)
  assert.match(groupSection, /data-testid=\{`kolom-sleephandvat-\$\{col\.key\}`\}/)
  assert.match(groupSection, /opacity: pressedColumnKey === col\.key \? 1 : 0/)
  assert.match(groupSection, /function finishColumnRename\(column: ColumnDef, save: boolean\)/)
  assert.match(groupSection, /setBoardColumns\(boardId, allColumns\.map/)
})

test('agenda group no longer offers select-all controls', () => {
  assert.doesNotMatch(groupSection, /selecteer alles/i)
  assert.doesNotMatch(groupSection, /onSelectGroup/)
})

test('individual row selection remains available', () => {
  assert.match(groupSection, /onToggleSelect/)
})
