import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning people expose a dedicated team drag handle in both views', () => {
  assert.match(planning, /function planningTeamDragHandle\(member: TeamMember\)/)
  assert.match(planning, /aria-label=\{`Sleep \$\{member\.name\} naar een ander team`\}/)
  assert.equal((planning.match(/planningTeamDragHandle\((?:m|member)\)/g) ?? []).length, 2)
  assert.match(planning, /application\/x-yoko-team-member/)
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

test('base sections only accept members of their existing profile kind', () => {
  assert.match(planning, /baseKind\?: 'yoko' \| 'freelancer'/)
  assert.match(planning, /target\.baseKind === \(isYokoCrew\(memberId\) \? 'yoko' : 'freelancer'\)/)
  assert.match(planning, /groupId: null, label: 'Team Yoko', baseKind: 'yoko'/)
  assert.match(planning, /groupId: null, label: 'Freelancers', baseKind: 'freelancer'/)
})
