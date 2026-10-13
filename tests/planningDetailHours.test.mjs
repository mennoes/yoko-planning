import test from 'node:test'
import assert from 'node:assert/strict'
import { planningDetailHours } from '../lib/planningDetailHours.ts'

test('subitem hours lead when subitems contain real estimates', () => {
  assert.deepEqual(
    planningDetailHours(40, [{ estHours: 12 }, { estHours: 8 }], { menno: 40 }),
    { total: 20, source: 'subitems' },
  )
})

test('parent hours keep the pie visible when placeholder subitems are all zero', () => {
  assert.deepEqual(
    planningDetailHours(40, [{ estHours: 0 }, { estHours: 0 }], { menno: 14.7, loeta: 8.4, vincent: 16.9 }),
    { total: 40, source: 'parent' },
  )
})

test('owner distribution is the final fallback when parent and subitems are zero', () => {
  assert.deepEqual(
    planningDetailHours(0, [{ estHours: 0 }], { menno: 14.7, loeta: 8.4, vincent: 16.9 }),
    { total: 40, source: 'owners' },
  )
})
