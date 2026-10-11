import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/personalCompletionClient.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('personal timelines use stable project targets instead of scanning every agenda per workload cell', () => {
  const helperStart = planning.indexOf('function projectForMember')
  const helperEnd = planning.indexOf('// groupsToProjects', helperStart)
  const helper = planning.slice(helperStart, helperEnd)
  assert.match(helper, /completionParentItemId/)
  assert.doesNotMatch(helper, /completionTargetForProject/)

  const hoursStart = planning.indexOf('function memberHoursInCol')
  const hoursEnd = planning.indexOf('function projectForMember', hoursStart)
  assert.doesNotMatch(planning.slice(hoursStart, hoursEnd), /projectForMember/)
  assert.match(planning, /const memberProjects = effectiveProjects\.map\(project => projectForMember\(project, member\.id\)\)/)
})

test('completion reads are memoized until the shared comment store changes', () => {
  assert.match(client, /const resolvedCompletions = new Map/)
  assert.match(client, /onCommentsUpdate\(\(\) => resolvedCompletions\.clear\(\)\)/)
})

test('agenda orders project fields before the equally shaped personal fields', () => {
  const start = board.indexOf('ordered.splice(insertAt, 0,')
  const end = board.indexOf('return ordered', start)
  const order = board.slice(start, end)
  assert.ok(order.indexOf('...(status ? [status]') < order.indexOf('...(timeline ? [timeline]'))
  assert.ok(order.indexOf('...(timeline ? [timeline]') < order.indexOf('PERSONAL_STATUS_KEY'))
  assert.ok(order.indexOf('PERSONAL_STATUS_KEY') < order.indexOf('PERSONAL_TIMELINE_KEY'))
  assert.match(board, /whiteSpace: 'nowrap'/)
})
