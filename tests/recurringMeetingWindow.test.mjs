import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleRecurringSubitems } from '../lib/recurringMeetingWindow.ts'

const now = new Date('2026-10-15T12:00:00+02:00')
const rows = [
  { id: 'history', startDate: '2026-09-01' },
  { id: 'within', startDate: '2026-12-10' },
  { id: 'too-far', startDate: '2026-12-11' },
  { id: 'undated', startDate: null },
]

test('Google recurring views keep history but stop after eight weeks', () => {
  assert.deepEqual(
    visibleRecurringSubitems('google', rows, now).map(row => row.id),
    ['history', 'within', 'undated'],
  )
})

test('manual items never lose future subitems', () => {
  assert.equal(visibleRecurringSubitems('manual', rows, now).length, rows.length)
})
