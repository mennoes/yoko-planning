import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  runInNewContext(js, { exports })
  return exports
}

test('vrij blocks eight hours per visible workday, including zero-hour calendar items', () => {
  const { blockedHoursForWorkdays } = load('../lib/freeCapacity.ts')
  assert.equal(blockedHoursForWorkdays(0), 0)
  assert.equal(blockedHoursForWorkdays(1), 8)
  assert.equal(blockedHoursForWorkdays(5), 40)
  assert.equal(blockedHoursForWorkdays(10), 80)
})

test('technical start-date records can never become planning members', () => {
  const { isTeamMetadataId } = load('../lib/teamMemberIdentity.ts')
  assert.equal(isTeamMetadataId('__team_start_date__:l'), true)
  assert.equal(isTeamMetadataId('__team_start_date__:j'), true)
  assert.equal(isTeamMetadataId('loeta'), false)
})

test('desktop sidebar has a persistent compact mode and keeps primary navigation accessible', () => {
  const source = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
  assert.match(source, /COLLAPSED_SIDEBAR_W = 68/)
  assert.match(source, /sidebar-collapsed/)
  assert.match(source, /aria-label="Menu inklappen"/)
  assert.match(source, /aria-label="Menu uitklappen"/)
  assert.match(source, /mainNav\.map/)
})

test('planning and shared workload totals both use blocked vrij hours', () => {
  const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
  const workload = readFileSync(new URL('../lib/workload.ts', import.meta.url), 'utf8')
  // Beide kanten rekenen vrij via dezelfde helper: standaard de hele
  // werkdag, en wie er zelf uren op zet krijgt die uren terug.
  assert.match(planning, /if \(isVrij\) return vrijHoursForOverlap\(\{/)
  assert.match(workload, /if \(isVrij\) return vrijHoursForOverlap\(\{/)
  assert.match(planning, /allowOwnHours: project\.source !== 'google'/)
  assert.match(workload, /allowOwnHours: project\.source !== 'google'/)
  assert.match(planning, /memberHours \+= hours/)
  assert.match(planning, /const totalWork = countWorkdaysMs\(pS\.getTime\(\), pE\.getTime\(\)\)/)
  assert.match(planning, /const overlapWork = countWorkdaysMs\(oS\.getTime\(\), oE\.getTime\(\)\)/)
  assert.doesNotMatch(planning, /if \(isVrijDayForMember\(memberId, d\)\) continue/)
})

test('profielfoto-metadata kan nooit als teamlid verschijnen', () => {
  // De foto-API bewaart elke foto als rij `__team_photo__:<lid>` met naam
  // 'Profielfoto'. Die stond eerder gewoon tussen de teamleden op Home.
  const { isTeamMetadataId } = load('../lib/teamMemberIdentity.ts')
  assert.equal(isTeamMetadataId('__team_photo__:menno'), true)
  assert.equal(isTeamMetadataId('__team_group__:producers'), true)
  assert.equal(isTeamMetadataId('menno'), false)
  assert.equal(isTeamMetadataId('anne-fleur'), false)
})
