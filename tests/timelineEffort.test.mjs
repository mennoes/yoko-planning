import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/timelineEffort.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
test('project rollup never adds the parent estimate twice and flags incomplete steps',()=>{
 const e=exports.timelineEffort({estHours:80,subitems:[{estHours:16},{estHours:8},{estHours:0}]})
 assert.equal(e.hours,24);assert.equal(e.missing,1)
 assert.equal(exports.timelineEffort({estHours:.5}).hours,.5)
})
test('waiting is explicit status, not a guess from feedback work',()=>{
 assert.equal(exports.isWaitingStatus('Wachten op klant'),true)
 assert.equal(exports.isWaitingStatus('Working on...'),false)
 assert.equal(exports.isWaitingStatus('Feedbackronde'),false)
})
test('next client moment excludes completed and past moments without reordering steps',()=>{
 const rows=[{name:'Late',deadline:'2026-11-20'},{name:'Done',deadline:'2026-11-09',status:'Done'},{name:'Past',deadline:'2026-11-01'},{name:'First',deadline:'2026-11-10'}]
 assert.equal(exports.nextClientMoment(rows,'2026-11-08').name,'First')
 assert.equal(rows[0].name,'Late')
})
