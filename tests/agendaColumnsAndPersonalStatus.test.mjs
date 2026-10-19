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

// Hier stonden drie 'prestatietests' die in werkelijkheid de vórm van de
// oplossing vastlegden: dat er `let completionIndex: Map<...> | null`
// stond, dat WorkloadCell in een memo() zat, dat de bord-index precies
// `const parentItemsByBoard = new Map<...>` heette. Die faalden bij elke
// hernoeming en slaagden als de index er stond maar niet gebruikt werd.
//
// De échte eis — blijft uitklappen snel? — wordt nu gemeten in
// tests-e2e/performance.test.mjs, in een browser op een productiebuild.
// Zie tests-e2e/harness.mjs voor hoe je die draait.
//
// Wat hieronder overblijft zijn geen prestatietests maar 'deze functie is
// er niet meer'-wachters, en die zijn wél stabiel: ze matchen op namen die
// bewust zijn weggehaald.

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
