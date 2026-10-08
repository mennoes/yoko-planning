import assert from 'node:assert/strict'
import test from 'node:test'
import { boardItemMatchesPeriod } from '../lib/boardPeriodFilter.ts'

const september = {
  from: new Date('2026-09-01').getTime(),
  until: new Date('2026-09-30').getTime() + 86_400_000 - 1,
}

function item(overrides = {}) {
  return {
    id: 'fti', name: 'FTI', ownerIds: [], status: '', startDate: null,
    endDate: null, deadline: null, estHours: 0, dagen: 0, ...overrides,
  }
}

test('parent with only August and October subitems is hidden in September', () => {
  const fti = item({
    subitems: [
      { id: 'done', name: 'FTI visuals', ownerIds: [], status: 'Done', startDate: '2026-08-05', endDate: '2026-08-05', estHours: 8 },
      { id: 'slides', name: 'FTI Slides', ownerIds: [], status: '', startDate: '2026-10-19', endDate: '2026-10-26', estHours: 40 },
      { id: 'vorm', name: 'FTI vormgeving', ownerIds: [], status: '', startDate: '2026-10-12', endDate: '2026-10-16', estHours: 32 },
    ],
  })
  assert.equal(boardItemMatchesPeriod(fti, september), false)
})

test('parent remains visible when its own range or a child overlaps the period', () => {
  assert.equal(boardItemMatchesPeriod(item({ startDate: '2026-09-21', endDate: '2026-10-24' }), september), true)
  assert.equal(boardItemMatchesPeriod(item({ subitems: [
    { id: 'sep', name: 'Septemberwerk', ownerIds: [], status: '', startDate: '2026-09-15', endDate: '2026-09-16', estHours: 4 },
  ] }), september), true)
})

test('fully undated new item stays visible while editing', () => {
  assert.equal(boardItemMatchesPeriod(item(), september), true)
})
