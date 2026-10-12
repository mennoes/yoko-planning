import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('timeline dragging stays local until pointer release', () => {
  const dragStart = planning.indexOf('function startDrag')
  const dragEnd = planning.indexOf('const g = ghost', dragStart)
  const drag = planning.slice(dragStart, dragEnd)

  assert.match(drag, /scheduleGhost\(\{ left: newL, width: newW/)
  assert.doesNotMatch(drag, /onDragMove\(ss, se\)/)
  assert.doesNotMatch(planning, /setShadowDrag/)
})

test('drag previews are capped to one render per animation frame', () => {
  assert.match(planning, /ghostRafRef\.current = requestAnimationFrame/)
  assert.match(planning, /if \(ghostRafRef\.current !== null\) return/)
})
