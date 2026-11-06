import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/sjabloonPlan.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const {verdeelWerkdagen,planUitSjabloon,SJABLONEN}=exports
const steps=SJABLONEN[0].stappen
test('total is distributed proportionally without rounding drift',()=>{
 const result=verdeelWerkdagen(steps,28)
 assert.equal(JSON.stringify(result.map(s=>s.dagen)),JSON.stringify([4,4,6,10,2,2]))
 for(let total=6;total<=100;total++){
  const allocated=verdeelWerkdagen(steps,total)
  assert.equal(allocated.reduce((sum,s)=>sum+s.dagen,0),total)
  assert.ok(allocated.every(s=>s.dagen>=1&&s.dagen<=60))
 }
})
test('a total cannot erase steps and respects duration bounds',()=>{
 assert.equal(verdeelWerkdagen(steps,2).reduce((sum,s)=>sum+s.dagen,0),6)
 assert.equal(verdeelWerkdagen(steps,999).reduce((sum,s)=>sum+s.dagen,0),360)
 assert.equal(verdeelWerkdagen([],10).length,0)
})
test('redistributed plan ends on deadline and hours match the chosen total',()=>{
 const result=planUitSjabloon({naam:'Test',stappen:verdeelWerkdagen(steps,10),deadline:'2026-11-27'})
 assert.ok(result.ok)
 assert.equal(result.plan.endDate,'2026-11-27')
 assert.equal(result.plan.estHours,80)
 assert.equal(result.plan.startDate,'2026-11-16')
})
