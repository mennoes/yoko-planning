import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeGoogleMeetingHistory } from '../lib/googleMeetingHistory.ts'
import { readFileSync } from 'node:fs'

const sync = readFileSync(new URL('../lib/googleSync.ts', import.meta.url), 'utf8')

test('old recurring occurrences remain readable as Done with their hours', () => {
  const merged = mergeGoogleMeetingHistory(
    [{ id: 'new', name: 'Overleg', startDate: '2026-11-01', endDate: '2026-11-01', estHours: 1 }],
    [[{ id: 'old', name: 'Overleg', startDate: '2026-07-01', endDate: '2026-07-01', estHours: 2 }]],
    new Set(),
    '2026-10-14',
  )
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[0], { id: 'old', name: 'Overleg', startDate: '2026-07-01', endDate: '2026-07-01', estHours: 2, status: 'Done' })
  assert.equal(merged[1].status, undefined)
})

test('history merge preserves edited hours and respects dismissed occurrences', () => {
  const merged = mergeGoogleMeetingHistory(
    [{ id: 'fresh', sourceItemId: 'same', startDate: '2026-08-01', estHours: 0 }],
    [[
      { id: 'old-copy', sourceItemId: 'same', startDate: '2026-08-01', estHours: 4, status: 'Done' },
      { id: 'dismissed', startDate: '2026-06-01', estHours: 8 },
    ]],
    new Set(['dismissed']),
    '2026-10-14',
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].estHours, 4)
  assert.equal(merged[0].status, 'Done')
})

test('sync repairs duplicate parents before hiding them and reads two years back', () => {
  assert.match(sync, /const WINDOW_DAYS_PAST\s+= 730/)
  assert.match(sync, /mergeGoogleMeetingHistory/)
  assert.match(sync, /De oude rij pas verbergen nadat de historie aantoonbaar veilig/)
})

test('a recreated recurring series recovers older same-board history without overlap', () => {
  assert.match(sync, /normalizedHistoryTitle/)
  assert.match(sync, /row\.board_id !== series\.boardId/)
  assert.match(sync, /dated\.every\(date => date < series\.firstDate\)/)
  assert.match(sync, /recoveredSubitems\.get\(series\.id\)/)
  assert.match(sync, /if \(!historyError\) recoveredSubitems\.set/)
})
