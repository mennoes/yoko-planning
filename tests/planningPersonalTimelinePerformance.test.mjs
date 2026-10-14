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

test('planning indexes projects per person and reuses stable completion ids', () => {
  assert.match(planning, /const datedProjectsByMember = useMemo\(\(\) =>/)
  assert.match(planning, /contributionsPerCell\(team, cols, effectiveProjects, loadCategoryOverrides\(\)\)/)
  assert.match(planning, /<TimelineBars memberId=\{member\.id\} projects=\{memberProjects\}/)
  assert.match(planning, /function planningCompletionTarget\(project: Project\)/)
  assert.match(planning, /project\.completionParentItemId/)
  assert.match(planning, /const WorkloadCell = memo\(function WorkloadCell/)
})

test('agenda nests personal status inside the project status menu', () => {
  assert.match(board, /column\.key !== '__personalTimeline' && column\.key !== PERSONAL_STATUS_KEY/)
  assert.match(board, /menuLabel="Status project" extraContent=\{statusExtra\}/)
  assert.match(board, /statusExtra=\{col\.key === 'status' && shared && !!profile\?\.memberId && effectiveOwners\.includes\(profile\.memberId\) \? <PersonalCompletionSection/)
  assert.doesNotMatch(board, /label: 'Jouw status'/)
  assert.match(board, /whiteSpace: 'nowrap'/)
  assert.match(personalSection, /owners\.length < 2/)
})

test('agenda column manager persists order and visibility for regular columns', () => {
  assert.match(board, /function completeColumnLayout\(columns: ColumnDef\[\]\)/)
  assert.match(board, /setBoardColumns\(boardId, next\)/)
  assert.match(board, /function toggleVisible\(key: string\)/)
  assert.match(board, /hidden: !c\.hidden/)
  assert.match(board, /draggable/)
  assert.match(board, /function moveTo\(from: number, to: number\)/)
  assert.match(board, /Houd een rij vast en sleep hem naar de gewenste plek/)
  assert.match(board, /\+ Kolom toevoegen/)
  assert.match(board, /removeCustom\(c\.key, c\.label\)/)
  assert.match(board, /const tableColumns = completeColumns\.filter\(column => !column\.hidden\)/)
  assert.match(board, /const dataColumns = completeColumns\.filter\(column => !isPersonalColumn\(column\.key\) && !column\.hidden\)/)
})

test('agenda headers support direct column reordering with a visible drop position', () => {
  assert.match(board, /application\/x-yoko-column/)
  assert.match(board, /onMoveColumn\(sourceKey, col\.key, side\)/)
  assert.match(board, /function moveColumn\(sourceKey: string, targetKey: string, side: 'before' \| 'after'\)/)
  assert.match(board, /boxShadow: columnDrop\?\.key === col\.key/)
  assert.match(board, /Sleep \$\{col\.label\} om de kolom te verplaatsen/)
  assert.match(board, /pressedColumnKey === col\.key/)
  assert.match(board, /onMouseDown=\{\(\) => \{ if \(!isMobile\) setPressedColumnKey\(col\.key\) \}\}/)
  // De grip blijft in de DOM terwijl de muis wordt ingedrukt. De eerdere
  // conditionele mount annuleerde in sommige browsers de native dragstart.
  assert.match(board, /\{!isMobile && <span aria-hidden/)
  assert.doesNotMatch(board, /\{!isMobile && pressedColumnKey === col\.key && <span/)
})

test('personal completion client only persists personal status', () => {
  assert.doesNotMatch(client, /timelineStart|timelineEnd/)
  assert.match(client, /parentItemId: target\.parentItemId, subitemId: target\.subitemId, memberId, done, status/)
})
