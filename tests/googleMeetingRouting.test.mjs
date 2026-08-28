import test from 'node:test'
import assert from 'node:assert/strict'
import { routeGoogleMeeting, findMeetingProject, nestedMeetingId, mergeNestedMeetings, saveNestedMeetings, loadMeetingPlacement } from '../lib/googleMeetingRouting.ts'

const boards = new Set(['yoko', 'nederland', 'vlaanderen', 'pnp'])
const event = (summary = 'Overleg', emails = [], patch = {}) => ({
  id: 'event-1', iCalUID: 'shared-event', summary,
  start: { dateTime: '2026-09-01T10:00:00+02:00' }, end: { dateTime: '2026-09-01T11:00:00+02:00' },
  attendees: emails.map(email => ({ email, responseStatus: 'accepted' })), ...patch,
})
const parent = (patch = {}) => ({
  id: 'project-1', name: 'De Vooruitblik', board_id: 'vlaanderen', group_id: 'projects',
  source: 'manual', status: '', deleted_at: null, external_link: null,
  updated_at: '2026-08-28T08:00:00.000Z', subitems: [], extra: { ownerHours: { menno: 12 } }, ...patch,
})
const sub = (patch = {}) => ({
  id: 'shared-event', name: 'Thumbs & titels De Vooruitblik - part 3', ownerIds: ['menno'], status: '',
  startDate: '2026-09-01', endDate: '2026-09-01', startTime: '10:00', endTime: '11:00',
  estHours: 1, source: 'google', externalLink: 'https://calendar.google.com/event?eid=example', ...patch,
})
const route = (...events) => routeGoogleMeeting(events, [], boards)

test('organization domains choose their agenda, regardless of capitalization', () => {
  assert.equal(route(event('Overleg', ['LOES@UNIVERSITEITVANNEDERLAND.NL'])).boardId, 'nederland')
  assert.equal(route(event('Overleg', ['katleen@universiteitvanvlaanderen.be'])).boardId, 'vlaanderen')
  assert.equal(route(event('Overleg', ['roel@pnpmedia.nl'])).boardId, 'pnp')
  assert.equal(route(event('Overleg', ['menno@studioyoko.nl', 'client@example.com'])).boardId, 'yoko')
})
test('university wins over PnP; domain wins over incidental title', () => {
  assert.equal(route(event('PnP overleg', ['a@pnpmedia.nl', 'b@universiteitvannederland.nl'])).boardId, 'nederland')
  assert.equal(route(event('UvVL check-in', ['a@pnpmedia.nl'])).boardId, 'vlaanderen')
  assert.equal(route(event('UvVL check-in', ['a@universiteitvannederland.nl'])).boardId, 'nederland')
})
test('conflicting universities need an unambiguous title', () => {
  const emails = ['a@universiteitvannederland.nl', 'b@universiteitvanvlaanderen.be']
  assert.deepEqual(route(event('Overleg', emails)), { boardId: 'yoko', reason: 'conflict' })
  assert.equal(route(event('UvNL overleg', emails)).boardId, 'nederland')
})
test('declined/resource attendees and lookalike domains do not route', () => {
  assert.equal(route(event('Overleg', ['a@eviluniversiteitvannederland.nl', 'b@universiteitvannederland.nl.evil.test'])).boardId, 'yoko')
  assert.equal(route(event('Overleg', [], { attendees: [
    { email: 'a@universiteitvannederland.nl', responseStatus: 'declined' },
    { email: 'room@pnpmedia.nl', resource: true },
  ] })).boardId, 'yoko')
  assert.equal(route(event('Overleg', [], { organizer: { email: 'a@universiteitvanvlaanderen.be' } })).boardId, 'vlaanderen')
})
test('title hints and configured rules work; no arbitrary substring or nonexistent board', () => {
  assert.equal(route(event('UvNL productieoverleg')).boardId, 'nederland')
  assert.equal(routeGoogleMeeting([event('KNRM briefing')], [{ pattern: 'knrm', board_id: 'nederland' }], boards).boardId, 'nederland')
  assert.equal(routeGoogleMeeting([event('bedienjaar')], [{ pattern: 'dienjaar', board_id: 'nederland' }], boards).boardId, 'yoko')
  assert.equal(routeGoogleMeeting([event('Xyz')], [{ pattern: 'xyz', board_id: 'missing' }], boards).boardId, 'yoko')
  assert.throws(() => routeGoogleMeeting([event()], [], new Set(['pnp'])), /Yoko/)
})
test('clear project match; ambiguous and generic names stay in Meetings', () => {
  const r = { boardId: 'vlaanderen', reason: 'participants' }
  assert.equal(findMeetingProject('Thumbs & titels De Vooruitblik - part 3', [parent()], r)?.id, 'project-1')
  assert.equal(findMeetingProject('Review Pink Floyd The Wall', [parent({ name: 'PinkFloyd - The Wall' })], r), null)
  assert.equal(findMeetingProject('Review Pink Floyd The Wall', [parent({ name: 'Pink Floyd - The Wall' })], r)?.id, 'project-1')
  assert.equal(findMeetingProject('Check-in huisstijl', [parent({ name: 'Huisstijl' })], r), null)
  assert.equal(findMeetingProject('Check-in Zin', [parent({ name: 'Zin' })], r), null)
  assert.equal(findMeetingProject('De Vooruitblik', [parent(), parent({ id: 'other' })], r), null)
  assert.equal(findMeetingProject('De Vooruitblik', [parent({ status: 'Done' })], r), null)
  assert.equal(findMeetingProject('De Vooruitblik', [parent({ source: 'google' })], r), null)
})
test('participant routing constrains project matching; neutral Yoko fallback may find a clear project elsewhere', () => {
  assert.equal(findMeetingProject('De Vooruitblik', [parent()], { boardId: 'nederland', reason: 'participants' }), null)
  assert.equal(findMeetingProject('De Vooruitblik', [parent()], { boardId: 'yoko', reason: 'fallback' })?.board_id, 'vlaanderen')
  assert.equal(findMeetingProject('De Vooruitblik', [parent()], { boardId: 'yoko', reason: 'conflict' }), null)
})
test('recurring identities survive rescheduling and calendar-specific event IDs', () => {
  const original = { dateTime: '2026-09-01T10:00:00+02:00' }
  const first = event('One', [], { recurringEventId: 'master1', originalStartTime: original })
  const moved = event('One', [], { id: 'different', recurringEventId: 'master2',
    originalStartTime: { dateTime: '2026-09-01T08:00:00Z' }, start: { dateTime: '2026-09-02T15:00:00+02:00' } })
  assert.equal(nestedMeetingId('shared-series', first), nestedMeetingId('shared-series', moved))
  assert.notEqual(nestedMeetingId('shared-series', first), nestedMeetingId('shared-series', event('Two', [], { recurringEventId: 'master1' , originalStartTime: { date: '2026-09-08' } })))
  assert.equal(nestedMeetingId('single', event()), 'single')
})
test('merge preserves unrelated subitems, manual hours/owners, Done overrides and project fields', () => {
  const previous = sub({ estHours: 0, ownerIds: ['odette'], status: '', statusOverride: 'active' })
  const p = parent({ subitems: [sub({ id: 'manual', source: 'manual' }), previous] })
  const result = mergeNestedMeetings(p, [sub({ startTime: '12:00', estHours: 5, status: 'Done' })], 'series')
  assert.equal(result.subitems.length, 2)
  assert.equal(result.subitems[1].estHours, 0)
  assert.equal(result.subitems[1].startTime, '12:00')
  assert.equal(result.subitems[1].status, '')
  assert.deepEqual(result.subitems[1].ownerIds, ['odette'])
  assert.deepEqual(result.extra.ownerHours, { menno: 12 })
  assert.deepEqual(result.extra.googleMeetingSeriesIds, ['series'])
  assert.equal(p.subitems[1].startTime, '10:00')
})
test('deleted occurrences are not recreated, including after deleting the last subitem', () => {
  const p = parent({ extra: { dismissedInstanceIds: ['shared-event'], googleMeetingSeriesIds: ['series'] } })
  assert.deepEqual(mergeNestedMeetings(p, [sub()], 'series').subitems, [])
})

// Tiny in-memory Supabase boundary: tests exercise the actual read/merge/CAS
// and placement path without touching production meetings or credentials.
function fakeDb(items, { raceOnce = false, failRead = false } = {}) {
  const tables = { board_items: structuredClone(items), board_groups: [{ id: 'projects', name: 'Projecten', deleted_at: null }] }
  let raced = false
  const db = { tables, from(table) {
    const filters = []; let patch; let range; let one = false
    const query = {
      select() { return query }, order() { return query },
      eq(key, value) { filters.push(row => row[key] === value); return query },
      is(key, value) { filters.push(row => row[key] === value); return query },
      range(start, end) { range = [start, end]; return query },
      single() { one = true; return query },
      update(value) { patch = value; return query },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (failRead && !patch) return { data: null, error: { message: 'offline' } }
        if (patch && raceOnce && !raced) {
          raced = true
          tables[table][0].subitems.push(sub({ id: 'concurrent-human-edit', source: 'manual' }))
          tables[table][0].updated_at = '2026-08-28T08:00:01.000Z'
        }
        let rows = tables[table].filter(row => filters.every(f => f(row)))
        if (range) rows = rows.slice(range[0], range[1] + 1)
        if (patch) for (const row of rows) Object.assign(row, structuredClone(patch))
        return { data: structuredClone(one ? rows[0] : rows), error: null }
      }).then(resolve, reject) },
    }
    return query
  } }
  return db
}
test('concurrent edits trigger a fresh merge; no lost human subitems', async () => {
  const db = fakeDb([parent()], { raceOnce: true })
  await saveNestedMeetings(db, 'project-1', [sub()], 'series')
  assert.deepEqual(db.tables.board_items[0].subitems.map(s => s.id), ['concurrent-human-edit', 'shared-event'])
})
test('auto-placement is idempotent, follows renamed projects, and respects deletion', async () => {
  const db = fakeDb([parent()])
  const r = { boardId: 'vlaanderen', reason: 'participants' }
  let placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'Thumbs De Vooruitblik', r, true, [sub()]), true)
  db.tables.board_items[0].name = 'Andere projectnaam'
  placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'Thumbs De Vooruitblik', r, true, [sub({ startTime: '13:00' })]), true)
  assert.equal(db.tables.board_items[0].subitems.length, 1)
  assert.equal(db.tables.board_items[0].subitems[0].startTime, '13:00')
  db.tables.board_items[0].subitems = []
  db.tables.board_items[0].extra.dismissedInstanceIds = ['shared-event']
  placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'Thumbs De Vooruitblik', r, true, [sub()]), true)
  assert.equal(db.tables.board_items[0].subitems.length, 0)
})
test('existing top-level meetings are not reparented; deleted parents are not revived', async () => {
  const db = fakeDb([parent()])
  let placement = await loadMeetingPlacement(db)
  const r = { boardId: 'vlaanderen', reason: 'participants' }
  assert.equal(await placement.place('series', 'De Vooruitblik', r, false, [sub()]), false)
  db.tables.board_items[0].deleted_at = '2026-08-28'
  db.tables.board_items[0].extra.googleMeetingSeriesIds = ['series']
  placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'De Vooruitblik', r, true, [sub()]), true)
  assert.equal(db.tables.board_items[0].subitems.length, 0)
})
test('a recurring series spanning unrelated titles stays in Meetings', async () => {
  const db = fakeDb([parent()])
  const placement = await loadMeetingPlacement(db)
  const result = await placement.place('series', 'De Vooruitblik', { boardId: 'vlaanderen', reason: 'participants' }, true,
    [sub(), sub({ id: 'other', name: 'Bespreking ander programma' })])
  assert.equal(result, false)
  assert.equal(db.tables.board_items[0].subitems.length, 0)
})
test('a manually moved occurrence is not added back to its automatic parent', async () => {
  const db = fakeDb([parent({ extra: { googleMeetingSeriesIds: ['series'] } }),
    parent({ id: 'new-parent', name: 'Handmatig gekozen project', subitems: [sub()] })])
  const placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'De Vooruitblik', { boardId: 'vlaanderen', reason: 'participants' }, true, [sub()]), true)
  assert.equal(db.tables.board_items[0].subitems.length, 0)
  assert.equal(db.tables.board_items[1].subitems.length, 1)
})
test('project discovery pages past 500 rows and fails safely on read errors', async () => {
  const db = fakeDb([...Array.from({ length: 500 }, (_, n) => parent({ id: `generic-${n}`, name: 'Project' })), parent()])
  const placement = await loadMeetingPlacement(db)
  assert.equal(await placement.place('series', 'De Vooruitblik', { boardId: 'vlaanderen', reason: 'participants' }, true, [sub()]), true)
  await assert.rejects(loadMeetingPlacement(fakeDb([], { failRead: true })), /laden/)
})
