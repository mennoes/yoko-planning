import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const teamGroups = readFileSync(new URL('../lib/teamGroups.ts', import.meta.url), 'utf8')

test('planning people expose a dedicated team drag handle in both views', () => {
  assert.match(planning, /function planningTeamDragHandle\(member: TeamMember\)/)
  assert.match(planning, /aria-label=\{`Sleep \$\{member\.name\} naar een ander team`\}/)
  assert.equal((planning.match(/planningTeamDragHandle\((?:m|member)\)/g) ?? []).length, 3)
  assert.match(planning, /application\/x-yoko-team-member/)
})

test('people manager is wide and uses the same persisted drop flow', () => {
  assert.match(planning, /<Popup title="Mensen & capaciteit" width=\{680\}/)
  assert.match(planning, /people-group-\$\{group\.id\}/)
  assert.match(planning, /movePlanningTeamMember\(m\.id/)
})

test('all built-in people sections are real drop targets and dropdown options', () => {
  assert.match(planning, /peopleYokoTarget: PlanningTeamDropTarget/)
  assert.match(planning, /peopleFreelanceTarget: PlanningTeamDropTarget/)
  assert.match(planning, /peopleInactiveTarget: PlanningTeamDropTarget/)
  assert.match(planning, /planningTeamDropProps\(peopleFreelanceTarget\)/)
  assert.match(planning, /planningTeamDropProps\(peopleInactiveTarget\)/)
  assert.match(planning, /<option value="base:freelance">Freelancers<\/option>/)
  assert.match(planning, /<option value="base:inactive">Inactief team<\/option>/)
})

test('planning group headers persist dropped members through the shared group store', () => {
  assert.match(planning, /function planningTeamDropProps\(target\?: PlanningTeamDropTarget\)/)
  assert.match(planning, /assignMemberToTeamGroup\(memberId, target\.groupId\)/)
  assert.match(planning, /Laat los/)
  assert.match(planning, /dropTarget: \{ key: `group-\$\{group\.id\}`/)
  assert.match(planning, /key: `group-\$\{group\.id\}-day`/)
})

test('empty custom teams remain visible as drop targets', () => {
  assert.equal((planning.match(/const groupedVisible = teamGroups\.map/g) ?? []).length, 2)
  assert.doesNotMatch(planning, /\}\)\)\.filter\(entry => entry\.members\.length > 0\)/)
})

test('fixed sections update the persisted member classification', () => {
  assert.match(planning, /baseKind\?: 'yoko' \| 'freelancer'/)
  assert.match(planning, /upsertTeamMember\(nextMember\)/)
  assert.match(planning, /target\.baseKind === 'freelancer' \? 'freelance'/)
  assert.match(planning, /groupId: null, label: 'Team Yoko', baseKind: 'yoko'/)
  assert.match(planning, /groupId: null, label: 'Freelancers', baseKind: 'freelancer'/)
  assert.match(planning, /label: 'Inactief team', inactive: true/)
})

test('drag validation uses a synchronous ref so the first dragover accepts the member', () => {
  assert.match(planning, /const draggingTeamMemberIdRef = useRef<string \| null>\(null\)/)
  assert.match(planning, /draggingTeamMemberIdRef\.current = member\.id/)
  assert.match(planning, /memberId = draggingTeamMemberIdRef\.current/)
})

test('failed remote group moves roll back instead of reverting silently after refresh', () => {
  assert.match(teamGroups, /if \(remoteExpected && !persisted\)/)
  assert.match(teamGroups, /write\(before\)/)
  assert.match(teamGroups, /throw new Error\('team_group_save_failed'\)/)
})
