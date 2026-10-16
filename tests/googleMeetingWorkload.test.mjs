import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the real transformation with only its storage/config boundary
// replaced. No browser session, API calls, or production records involved.
function loadModule(file, mocks, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  runInNewContext(js, { exports, URL, ...globals, require(id) {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`)
    return mocks[id]
  } })
  return exports
}
const category = { isVrijTitle: () => false, loadCategoryOverrides: () => ({}) }
const itemHours = loadModule('../lib/itemHours.ts', {})
const { groupsToProjects } = loadModule('../lib/workload.ts', {
  './boardsRegistry': { getBoardColor: () => '#000' }, './workloadCategory': category,
  './freeCapacity': { blockedHoursForWorkdays: days => days * 8 },
  './recurringMeetingWindow': { visibleRecurringSubitems: (_source, rows) => rows },
  './itemHours': itemHours,
})
const meeting = {
  id: 'meeting', name: 'Project overleg', ownerIds: ['menno'], status: '',
  startDate: '2099-09-01', endDate: '2099-09-01', estHours: 1,
  source: 'google', googleSeriesId: 'series',
}
const item = {
  id: 'project', name: 'Vooruitblik', ownerIds: ['menno'], source: 'manual', status: '',
  startDate: '2099-09-01', endDate: '2099-09-30', estHours: 40,
}
const groups = subitems => [{ id: 'projects', name: 'Projecten', items: [{ ...item, subitems }] }]

test('auto-nested meeting adds hours without replacing the original project', () => {
  const output = groupsToProjects('vlaanderen', groups([meeting]))
  assert.equal(output.length, 2)
  assert.equal(output.reduce((sum, p) => sum + p.estHours, 0), 41)
  assert.equal(output.find(p => p.id === 'vlaanderen__project').estHours, 40)
  assert.equal(output.find(p => p.id.endsWith('__si0')).source, 'google')
})
test('existing dated subitems and indices stay intact when meetings are attached', () => {
  const manual = { ...meeting, id: 'work', source: 'manual', googleSeriesId: undefined, estHours: 8, name: 'Artwork' }
  const output = groupsToProjects('vlaanderen', groups([manual, meeting]))
  // De handmatige sub is de uitsplitsing van het hoofdtotaal; de losse
  // Google-afspraak komt daar als werkelijk extra agendawerk bovenop.
  assert.equal(output.reduce((sum, p) => sum + p.estHours, 0), 9)
  assert.equal(output.find(p => p.id.endsWith('__si0')).source, 'manual')
  assert.equal(output.find(p => p.id.endsWith('__si1')).source, 'google')
})
test('existing undated subtasks retain their previous workload', () => {
  const manual = { ...meeting, id: 'work', source: 'manual', googleSeriesId: undefined, startDate: null, endDate: null, estHours: 8 }
  const before = groupsToProjects('vlaanderen', groups([manual]))
  const after = groupsToProjects('vlaanderen', groups([manual, meeting]))
  assert.equal(after.reduce((sum, p) => sum + p.estHours, 0), before[0].estHours + 1)
})
test('agenda and planning treat manual subitems as the parent rollup', () => {
  const undated = { ...meeting, id: 'undated', source: 'manual', startDate: null, endDate: null, estHours: 8 }
  const output = groupsToProjects('omdenken', groups([undated]))
  assert.equal(output.length, 1)
  assert.equal(output[0].estHours, 8)
})
test('a recurring Google parent never duplicates the hours of its dated occurrences', () => {
  const occurrence = {
    ...meeting,
    id: 'weekstart-2026-10-12',
    name: 'Weekstart',
    ownerIds: ['menno', 'vincent', 'anne-fleur'],
    startDate: '2026-10-12', endDate: '2026-10-12', estHours: 1.5,
  }
  const recurring = [{ id: 'meetings', name: 'Meetings', items: [{
    id: 'weekstart', name: 'Weekstart', source: 'google', status: 'Doorlopend',
    ownerIds: occurrence.ownerIds,
    startDate: '2026-10-12', endDate: '2026-12-07',
    // Oud serietotaal op de container: dit mag nooit als extra project tellen.
    estHours: 147.5,
    subitems: [occurrence],
  }] }]
  const output = groupsToProjects('yoko', recurring)
  assert.equal(output.length, 1)
  assert.equal(output[0].id, 'yoko__weekstart__si0')
  assert.equal(output.reduce((sum, project) => sum + project.estHours, 0), 1.5)
})

test('a Google meeting in a wrongly named Vrij group stays a meeting, not an 8-hour day', () => {
  const api = loadModule('../lib/workload.ts', {
    './boardsRegistry': { getBoardColor: () => '#000' }, './workloadCategory': category,
    './freeCapacity': { blockedHoursForWorkdays: days => days * 8 },
    './recurringMeetingWindow': { visibleRecurringSubitems: (_source, rows) => rows },
    './itemHours': itemHours,
  })
  const project = {
    id: 'weekstart', name: 'Weekstart', group: 'Vrij', source: 'google',
    ownerIds: ['menno'], startDate: '2026-10-12', endDate: '2026-10-12',
    estHours: 1.5, status: 'active',
  }
  const week = new Date('2026-10-12T00:00:00')
  assert.equal(api.projectHoursInWeek(project, 'menno', week), 1.5)
  assert.equal(api.projectHoursInWeek(project, 'menno', week, 'meeting'), 1.5)
})

test('agenda and workload use the same canonical item roll-up', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  const helperStart = board.indexOf('export function effectiveHours')
  const helper = board.slice(helperStart, board.indexOf('export function effectiveDays', helperStart))
  assert.match(board, /import \{ itemRollupHours \} from '@\/lib\/itemHours'/)
  assert.match(helper, /return itemRollupHours\(item, visibleSubs\)/)
})

test('recurring Google meetings are limited to eight weeks ahead', () => {
  const sync = readFileSync(new URL('../lib/googleSync.ts', import.meta.url), 'utf8')
  assert.match(sync, /const RECURRING_DAYS_FUTURE = RECURRING_MEETING_FUTURE_DAYS\b/)
  assert.match(sync, /est_hours:\s+0,/)
  assert.match(sync, /prev\?\.hoursOverride/)
  assert.match(sync, /eventHours\(ev\) \* occurrenceOwners\.length/)
})
test('personal calendar view ignores a manually retained owner who is not an accepted Google participant', () => {
  const google = {
    ...meeting,
    ownerIds: ['menno', 'job', 'ilse'],
    googleParticipantIds: ['job', 'ilse'],
    googleCalendarMemberIds: ['vincent'],
    startDate: '2026-10-13', endDate: '2026-10-13',
  }
  const projects = groupsToProjects('yoko', [{ id: 'meetings', name: 'Meetings', items: [google] }])
  const week = new Date('2026-10-12T00:00:00')
  const strict = loadModule('../lib/workload.ts', {
    './boardsRegistry': { getBoardColor: () => '#000' }, './workloadCategory': category,
    './freeCapacity': { blockedHoursForWorkdays: days => days * 8 },
    './recurringMeetingWindow': { visibleRecurringSubitems: (_source, rows) => rows },
    './itemHours': itemHours,
  }).memberContributions(projects, 'menno', week, { acceptedGoogleOnly: true })
  assert.equal(strict.length, 0)
})
test('personal calendar view hides legacy Google rows without verified participant data', () => {
  const legacy = {
    ...meeting,
    ownerIds: ['menno'],
    startDate: '2026-10-13', endDate: '2026-10-13',
  }
  const projects = groupsToProjects('yoko', [{ id: 'meetings', name: 'Meetings', items: [legacy] }])
  const week = new Date('2026-10-12T00:00:00')
  const strict = loadModule('../lib/workload.ts', {
    './boardsRegistry': { getBoardColor: () => '#000' }, './workloadCategory': category,
    './freeCapacity': { blockedHoursForWorkdays: days => days * 8 },
    './recurringMeetingWindow': { visibleRecurringSubitems: (_source, rows) => rows },
    './itemHours': itemHours,
  }).memberContributions(projects, 'menno', week, { acceptedGoogleOnly: true })
  assert.equal(strict.length, 0)
})
test('a completed attached meeting does not hide the parent task or change its dates', () => {
  const mockGroups = groups([{ ...meeting, status: 'Done', startDate: '2000-01-01', endDate: '2000-01-01' }])
  const mocks = {
    './boardStore': { loadGroups: board => board === 'vlaanderen' ? mockGroups : [] },
    './boardsRegistry': { getBoardIds: () => ['vlaanderen'] },
    './workloadCategory': category,
    './todosStore': { loadSections: () => [] },
    './commentsStore': { loadAllComments: () => [] },
    './personalCompletion': { completionState: () => undefined },
  }
  for (const board of ['yoko', 'pnp', 'nederland', 'vlaanderen', 'dienjaar']) mocks[`@/data/boards/${board}.json`] = { groups: [] }
  const api = loadModule('../lib/todoProjectSeed.ts', mocks, { window: { localStorage: { getItem: () => null } } })
  const todos = api.mergeMemberTodoItems([], 'menno')
  assert.equal(todos.length, 1)
  assert.equal(todos[0].projectRef.itemId, 'project')
  assert.equal(todos[0].projectRef.startDate, '2099-09-01')
})
