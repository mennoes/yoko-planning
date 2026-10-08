import assert from 'node:assert/strict'
import test from 'node:test'
import { materializeFilteredBoardItem } from '../lib/materializeFilteredBoardItem.ts'

const original = {
  id: 'fti', name: 'FTI', ownerIds: ['menno'], status: '',
  startDate: '2026-10-12', endDate: '2026-10-31', deadline: null,
  estHours: 4, dagen: 0.5, ownerHours: { menno: 4 },
  subitems: [
    { id: 'slides', name: 'Slides', ownerIds: ['menno'], status: '', startDate: '2026-10-19', endDate: '2026-10-26', estHours: 14 },
    { id: 'vorm', name: 'Vorm', ownerIds: ['menno'], status: '', startDate: '2026-10-12', endDate: '2026-10-16', estHours: 16 },
    { id: 'shorts', name: 'Shorts', ownerIds: [], status: '', startDate: '2026-10-12', endDate: '2026-10-31', estHours: 10 },
    { id: 'done', name: 'Done', ownerIds: [], status: 'Done', startDate: '2026-09-01', endDate: '2026-09-03', estHours: 8 },
  ],
}

test('timeline edits never persist prorated zero hours or drop filtered-out subitems', () => {
  const filtered = {
    ...original,
    estHours: 0,
    ownerHours: { menno: 0 },
    __originalEstHours: 4,
    __prorated: true,
    subitems: original.subitems.slice(0, 3).map(sub => ({ ...sub, estHours: 0, __originalEstHours: sub.estHours })),
  }
  const updated = { ...filtered, startDate: null, endDate: null, datesOverride: false }
  const result = materializeFilteredBoardItem(original, filtered, updated)

  assert.equal(result.estHours, 4)
  assert.deepEqual(result.ownerHours, { menno: 4 })
  assert.deepEqual(result.subitems.map(sub => sub.estHours), [14, 16, 10, 8])
  assert.equal(result.subitems.length, 4)
  assert.equal(result.startDate, null)
})

test('deliberate hour edits and deletions remain possible in a filtered view', () => {
  const filtered = {
    ...original,
    estHours: 1,
    __originalEstHours: 4,
    __prorated: true,
    subitems: original.subitems.slice(0, 2).map(sub => ({ ...sub, estHours: 0, __originalEstHours: sub.estHours })),
  }
  const updated = {
    ...filtered,
    estHours: 6,
    subitems: [{ ...filtered.subitems[0], estHours: 7 }],
  }
  const result = materializeFilteredBoardItem(original, filtered, updated)

  assert.equal(result.estHours, 6)
  assert.deepEqual(result.subitems.map(sub => [sub.id, sub.estHours]), [
    ['slides', 7],
    ['shorts', 10],
    ['done', 8],
  ])
})
