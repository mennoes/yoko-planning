import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
function load(name) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code,{ exports, require: name => load(name.replace('./','')), Date, Math, Number, String, Set })
  return exports
}
const { changePlanPeriod, updatePlanSteps, daysBetween } = load('planTimeline')
const { planUitSjabloon, werkdagenIn } = load('sjabloonPlan')
const sample = () => planUitSjabloon({ naam:'Test', deadline:'2026-11-30', stappen:[{naam:'A',dagen:2},{naam:'B',dagen:3}], ownerIds:['menno'] }).plan

test('editing days crosses weekends and updates effort without changing owners', () => {
 const p = sample(); const next = changePlanPeriod(p,0,'days',4)
 assert.equal(werkdagenIn(next.subitems[0].startDate,next.subitems[0].endDate),4)
 assert.equal(next.subitems[0].estHours,32)
 assert.equal(next.subitems[0].ownerIds[0],'menno')
 assert.equal(next.estHours,56)
})
test('moving parent preserves child working durations and total hours', () => {
 const p = sample(); const next = changePlanPeriod(p,-1,'move',3)
 assert.equal(next.estHours,p.estHours)
 for(let i=0;i<p.subitems.length;i++) {
  assert.equal(werkdagenIn(next.subitems[i].startDate,next.subitems[i].endDate),werkdagenIn(p.subitems[i].startDate,p.subitems[i].endDate))
  assert.ok(next.subitems[i].startDate>=next.startDate && next.subitems[i].endDate<=next.endDate)
 }
})
test('resizing parent keeps all children in range and recalculates totals', () => {
 for(const count of [1,3,12]) {
  const next=changePlanPeriod(sample(),-1,'days',count)
  assert.equal(werkdagenIn(next.startDate,next.endDate),count)
  assert.equal(next.estHours,next.subitems.reduce((n,s)=>n+s.estHours,0))
  for(const s of next.subitems) assert.ok(s.startDate>=next.startDate && s.endDate<=next.endDate && s.estHours>=8)
 }
})
test('deleting steps recomputes bounds and keeps an editable parent after last deletion', () => {
 const p=sample(); const next=updatePlanSteps(p,[p.subitems[0]])
 assert.equal(next.endDate,p.subitems[0].endDate)
 assert.equal(next.estHours,16)
 const empty=updatePlanSteps(next,[])
 assert.equal(empty.estHours,0)
 assert.ok(empty.startDate && empty.endDate)
})
test('calendar-day distance stays stable across daylight saving', () => assert.equal(daysBetween('2026-10-24','2026-10-26'),2))
