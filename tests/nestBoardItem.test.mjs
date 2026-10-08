import assert from 'node:assert/strict'
import test from 'node:test'
import { boardItemToNestedSubitem } from '../lib/nestBoardItem.ts'

test('nesting gives the subitem an independent identity', () => {
  const source = {
    id: 'thumbs-23', name: 'Thumbs x 23', ownerIds: ['menno'], status: 'Working on...',
    startDate: '2026-09-21', endDate: '2026-10-31', deadline: null,
    estHours: 8, dagen: 1,
  }
  const nested = boardItemToNestedSubitem(source, 123)
  assert.equal(nested.id, 'si_nested_thumbs-23_123')
  assert.notEqual(nested.id, source.id)
  assert.equal(nested.sourceItemId, source.id)
})

test('nesting preserves the total and a recoverable copy of existing children', () => {
  const source = {
    id: 'parent', name: 'Parent', ownerIds: [], status: '', startDate: null,
    endDate: null, deadline: null, estHours: 4, dagen: 0.5,
    subitems: [
      { id: 'child', name: 'Child', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 6 },
    ],
  }
  const nested = boardItemToNestedSubitem(source, 456)
  assert.equal(nested.estHours, 10)
  assert.equal(nested.nestedSource?.estHours, 4)
  assert.deepEqual(nested.nestedSource?.subitems, source.subitems)
})
