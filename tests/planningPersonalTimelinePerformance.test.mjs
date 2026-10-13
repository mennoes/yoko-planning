import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/personalCompletionClient.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const personalSection = readFileSync(new URL('../components/PersonalCompletionSection.tsx', import.meta.url), 'utf8')

test('retired personal timelines no longer affect Agenda or Planning', () => {
  assert.doesNotMatch(planning, /function projectForMember/)
  assert.doesNotMatch(planning, /__personalMemberId/)
  assert.doesNotMatch(planning, /Jouw timeline/)
  assert.doesNotMatch(personalSection, /PersonalTimelineSection/)
  assert.doesNotMatch(board, /label: 'Jouw timeline'/)
  assert.match(board, /column\.key !== '__personalTimeline'/)
})

test('completion reads are memoized until the shared comment store changes', () => {
  assert.match(client, /let completionIndex: Map<string, CompletionState> \| null = null/)
  assert.match(client, /function loadCompletionIndex\(\)/)
  assert.match(client, /for \(const thread of loadAllComments\(\)\)/)
  assert.match(client, /onCommentsUpdate\(\(\) => \{ completionIndex = null \}\)/)
  assert.doesNotMatch(client, /completionState\(loadAllComments\(\)/)
})

test('agenda orders project fields before the personal status field', () => {
  const start = board.indexOf('ordered.splice(insertAt, 0,')
  const end = board.indexOf('return ordered', start)
  const order = board.slice(start, end)
  assert.ok(order.indexOf('...(status ? [status]') < order.indexOf('...(timeline ? [timeline]'))
  assert.ok(order.indexOf('...(timeline ? [timeline]') < order.indexOf('PERSONAL_STATUS_KEY'))
  assert.doesNotMatch(order, /PERSONAL_TIMELINE_KEY/)
  assert.match(board, /whiteSpace: 'nowrap'/)
  assert.match(personalSection, /layout === 'cell'\) return <div[^>]+height: '100%'/)
  assert.doesNotMatch(board, /padding: personal \? 0 : '4px 8px'/)
})

test('agenda column manager persists order and visibility for regular and personal status columns', () => {
  assert.match(board, /function completeColumnLayout\(columns: ColumnDef\[\]\)/)
  assert.match(board, /setBoardColumns\(boardId, next\)/)
  assert.match(board, /function toggleVisible\(key: string\)/)
  assert.match(board, /hidden: !c\.hidden/)
  assert.match(board, /draggable/)
  assert.match(board, /function moveTo\(from: number, to: number\)/)
  assert.match(board, /const tableColumns = completeColumns\.filter\(column => !column\.hidden\)/)
  assert.match(board, /const dataColumns = completeColumns\.filter\(column => !isPersonalColumn\(column\.key\) && !column\.hidden\)/)
})

test('personal completion client only persists personal status', () => {
  assert.doesNotMatch(client, /timelineStart|timelineEnd/)
  assert.match(client, /parentItemId: target\.parentItemId, subitemId: target\.subitemId, memberId, done, status/)
})
