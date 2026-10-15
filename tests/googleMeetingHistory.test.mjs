import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allDatedOccurrencesBefore,
  mergeGoogleMeetingHistory,
  occurrencesBefore,
  pastBillableOccurrences,
  historicalOccurrencesOnly,
  preserveStoredHistory,
} from '../lib/googleMeetingHistory.ts'
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

test('a recreated recurring series recovers older same-board history even when the old series overlaps', () => {
  assert.match(sync, /normalizedHistoryTitle/)
  assert.match(sync, /row\.board_id !== series\.boardId/)
  assert.match(sync, /occurrencesBefore\(allOccurrences, series\.firstDate\)/)
  assert.match(sync, /allDatedOccurrencesBefore\(candidate\.allOccurrences, series\.firstDate\)/)
  assert.match(sync, /recoveredSubitems\.get\(series\.id\)/)
  assert.match(sync, /if \(!historyError\) \{[\s\S]*recoveredSubitems\.set\(series\.id, merged\)/)
  const titleRepair = sync.slice(sync.indexOf('const normalizedHistoryTitle'), sync.indexOf('if (canonicalByExt.size > 0)'))
  assert.doesNotMatch(titleRepair, /\.not\('deleted_at', 'is', null\)/)
  assert.match(titleRepair, /candidate\.row\.deleted_at/)
})

test('history before a replacement series is recovered without hiding an overlapping source row', () => {
  const oldSeries = [
    { id: 'aug', startDate: '2026-08-12', endDate: '2026-08-12' },
    { id: 'sep', startDate: '2026-09-16', endDate: '2026-09-16' },
    { id: 'nov', startDate: '2026-11-11', endDate: '2026-11-11' },
  ]
  assert.deepEqual(occurrencesBefore(oldSeries, '2026-10-14').map(item => item.id), ['aug', 'sep'])
  assert.equal(allDatedOccurrencesBefore(oldSeries, '2026-10-14'), false)
  assert.equal(allDatedOccurrencesBefore(oldSeries.slice(0, 2), '2026-10-14'), true)
})

test('shared meeting history is recovered across linked Google accounts', () => {
  const repairBlock = sync.slice(sync.indexOf('if (canonicalByICal.size > 0)'), sync.indexOf('if (canonicalByExt.size > 0)'))
  assert.match(repairBlock, /Bewust account-overstijgend/)
  assert.doesNotMatch(repairBlock, /\.eq\('external_user_id', cal\.user_id\)/)
})

test('a historical top-level Google event becomes a subitem before dedupe', () => {
  assert.match(sync, /function historicalSubitemsForRow/)
  assert.match(sync, /id: `si_history_\$\{row\.id\}`/)
  assert.match(sync, /estHours: Number\(row\.est_hours\) \|\| 0/)
  assert.match(sync, /duplicates\.map\(historicalSubitemsForRow\)/)
  assert.match(sync, /Een oude losse occurrence mag pas verdwijnen nadat hij als subitem/)
  assert.match(sync, /if \(mergeError\) continue/)
})

test('legacy Google rows without a source flag still participate in history recovery', () => {
  assert.match(sync, /function isGoogleHistoryRow/)
  assert.match(sync, /row\.source === 'google' \|\| row\.ical_uid \|\| row\.external_id \|\| row\.calendar_id/)
  const titleRepair = sync.slice(sync.indexOf('const normalizedHistoryTitle'), sync.indexOf('if (canonicalByExt.size > 0)'))
  assert.match(titleRepair, /if \(!isGoogleHistoryRow\(row\)\) return false/)
  assert.doesNotMatch(titleRepair, /\.eq\('source', 'google'\)/)
})

test('past occurrences with hours are recognised as billable history', () => {
  const today = '2026-10-14'
  const subitems = [
    { id: 'past-hours',   startDate: '2026-08-12', endDate: '2026-08-12', estHours: 0.8, status: 'Done' },
    { id: 'past-nohours', startDate: '2026-09-09', endDate: '2026-09-09', estHours: 0 },
    { id: 'future',       startDate: '2026-11-11', endDate: '2026-11-11', estHours: 1 },
  ]
  assert.deepEqual(pastBillableOccurrences(subitems, today).map(s => s.id), ['past-hours'])
  assert.deepEqual(historicalOccurrencesOnly(subitems, today).map(s => s.id), ['past-hours', 'past-nohours'])
})

test('a series without past hours carries no billable history', () => {
  const today = '2026-10-14'
  const futureOnly = [
    { id: 'a', startDate: '2026-10-14', endDate: '2026-10-14', estHours: 1 },
    { id: 'b', startDate: '2026-12-09', endDate: '2026-12-09', estHours: 1 },
  ]
  assert.equal(pastBillableOccurrences(futureOnly, today).length, 0)
  assert.equal(historicalOccurrencesOnly(futureOnly, today).length, 0)
})

test('editing a Done occurrence wins over the stored value after refresh', () => {
  const result = preserveStoredHistory(
    [{ id: 'same', name: 'Nieuwe naam', status: 'Working on...', startDate: '2026-08-12', estHours: 0 }],
    [{ id: 'same', name: 'Oude naam', status: 'Done', startDate: '2026-08-12', estHours: 4 }],
    new Set(),
    '2026-10-15',
  )
  assert.deepEqual(result, [
    { id: 'same', name: 'Nieuwe naam', status: 'Working on...', startDate: '2026-08-12', estHours: 0 },
  ])
})

test('the write guard only appends genuinely missing historical occurrences', () => {
  const result = preserveStoredHistory(
    [{ id: 'current', sourceItemId: 'google-current', startDate: '2026-11-01', estHours: 1 }],
    [{ id: 'history', sourceItemId: 'google-history', startDate: '2026-08-12', estHours: 0.8, status: 'Done' }],
    new Set(),
    '2026-10-15',
  )
  assert.deepEqual(result.map(item => item.id), ['history', 'current'])
})

test('declined or vanished Google rows keep their billable history visible', () => {
  // Het opruimpad voor geweigerde/verdwenen afspraken verborg vroeger de hele
  // rij, inclusief afgeronde occurrences met uren. Die uren waren daarna in
  // geen enkele weergave meer uit te lezen.
  const cleanup = sync.slice(sync.indexOf('const irrelevantIds ='))
  assert.match(cleanup, /pastBillableSubitems\(row, todayIso\)\.length === 0/)
  assert.match(cleanup, /historicalOccurrencesOnly\(subitems, todayIso\)/)
  // Alleen rijen zonder voorbije uren mogen nog verborgen worden.
  assert.match(cleanup, /\.in\('id', hideIds\)/)
  assert.doesNotMatch(cleanup, /\.in\('id', irrelevantIds\)/)
})

test('the Google cleanup button never hard-deletes rows that carry past hours', () => {
  const cleanup = readFileSync(new URL('../app/api/google/cleanup/route.ts', import.meta.url), 'utf8')
  // Opschonen moet omkeerbaar zijn: soft-delete, geen .delete().
  assert.match(cleanup, /deleted_at: hiddenAt/)
  assert.doesNotMatch(cleanup, /from\('board_items'\)\s*\.delete\(\)/)
  // En rijen met al gemaakte uren blijven sowieso staan.
  assert.match(cleanup, /carriesPastHours\(r, todayIso\)/)
  assert.match(cleanup, /pastBillableOccurrences/)
})
