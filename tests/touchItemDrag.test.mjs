import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const drag = readFileSync(new URL('../lib/touchItemDrag.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('slepen op touch gebruikt pointer-events in plaats van de HTML5-drag-API', () => {
  // dragstart/drop vuren niet op touch; daarom bestaat deze laag.
  assert.match(drag, /window\.addEventListener\('pointermove', onMove, \{ passive: false \}\)/)
  assert.match(drag, /window\.addEventListener\('pointerup', onUp\)/)
  assert.match(drag, /window\.addEventListener\('pointercancel', onCancel\)/)
})

test('hit-testen kijkt door sticky kolommen en overlays heen', () => {
  // Met elementFromPoint (enkelvoud) kreeg je het bovenste element, en dat
  // is op deze tabel vaak een sticky kolom zonder rij-ancestor — dan vond
  // je nooit een droptarget.
  assert.match(drag, /document\.elementsFromPoint\(x, y\)/)
  assert.match(drag, /stack\.map\(el => el\.closest<HTMLElement>\('\[data-item-id\]'\)\)\.find\(Boolean\)/)
  assert.match(drag, /stack\.map\(el => el\.closest<HTMLElement>\('\[data-group-id\]'\)\)\.find\(Boolean\)/)
})

test('midden van een rij nestelt, de rest van een groep verplaatst', () => {
  // Zelfde zone-indeling als de desktopversie in BoardTable.
  assert.match(drag, /offset > rect\.height \* 0\.25 && offset < rect\.height \* 0\.75/)
  assert.match(drag, /return \{ kind: 'nest', itemId: row\.dataset\.itemId \}/)
  assert.match(drag, /if \(groupId && groupId !== sourceGroupId\) return \{ kind: 'group', groupId \}/)
  // Nooit op zichzelf droppen.
  assert.match(drag, /row\.dataset\.itemId !== sourceItemId/)
})

test('de greep start pas na vasthouden en laat de muis met rust', () => {
  assert.match(board, /if \(event\.pointerType === 'mouse'\) return/)
  assert.match(board, /\}, 280\)/)
  // Bewegen voordat de tijd om is = scrollen, geen sleepactie.
  assert.match(board, /if \(Math\.abs\(move\.clientX - startX\) > 10 \|\| Math\.abs\(move\.clientY - startY\) > 10\) stopWatching\(\)/)
  assert.match(board, /startTouchItemDrag\(native, \{/)
})

test('de drop roept dezelfde acties aan als de desktopversie', () => {
  assert.match(board, /if \(target\.kind === 'nest'\) onNestItem\(item\.id, group\.id, target\.itemId\)/)
  assert.match(board, /else onMoveItemToGroup\(item\.id, group\.id, target\.groupId\)/)
  assert.match(board, /onMoveItemToGroup=\{moveItemBetweenGroups\}/)
})

test('op touch is de greep zichtbaar en groot genoeg voor een vinger', () => {
  assert.match(board, /\? \{ opacity: 1, width: 24, height: 34, fontSize: 16, touchAction: 'none' as const \}/)
})
