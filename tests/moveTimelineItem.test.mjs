import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
function load(name,mocks={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,require:id=>mocks[id]});return exports}
const {moveTimelineItem:move}=load('moveTimelineItem',{'./itemDatums':load('itemDatums')})
const item={id:'p',name:'Project',startDate:'2026-11-09',endDate:'2026-11-20',deadline:'2026-11-20',estHours:80,ownerIds:['menno'],subitems:[{id:'a',startDate:'2026-11-09',endDate:'2026-11-11',deadline:'2026-11-12',estHours:24,ownerIds:['odette']},{id:'b',startDate:null,endDate:null,estHours:8}]}
test('moving project shifts steps but preserves client deadlines, hours and owners',()=>{
 const result=move(item,'2026-11-11','2026-11-22')
 assert.equal(result.subitems[0].startDate,'2026-11-11')
 assert.equal(result.subitems[0].endDate,'2026-11-13')
 assert.equal(result.subitems[0].deadline,'2026-11-12')
 assert.equal(result.deadline,'2026-11-20')
 assert.equal(result.estHours,80)
 assert.equal(result.subitems[0].ownerIds[0],'odette')
 assert.equal(result.subitems[1].startDate,null)
 assert.equal(item.subitems[0].startDate,'2026-11-09')
})
test('moving one subitem does not shift siblings or project',()=>{
 const result=move(item,'2026-11-12','2026-11-14','a')
 assert.equal(result.startDate,item.startDate)
 assert.equal(result.subitems[1],item.subitems[1])
 assert.equal(result.subitems[0].startDate,'2026-11-12')
})
test('a project with borrowed dates uses the effective start when moving',()=>{
 const result=move({...item,startDate:null,endDate:null},'2026-11-10','2026-11-12')
 assert.equal(result.subitems[0].startDate,'2026-11-10')
})
