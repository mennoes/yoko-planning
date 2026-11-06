import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/clientMilestones.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const {applyClientMoments,clientMoment,momentKey}=exports
const rows=[{name:'Script',endDate:'2026-11-10',estHours:16},{name:'Feedbackronde',endDate:'2026-11-11',estHours:8}]
test('suggestions become actual subitem deadlines without changing effort',()=>{const item=applyClientMoments({subitems:rows,estHours:24},{},true);assert.equal(item.subitems[0].deadline,'2026-11-10');assert.equal(item.subitems[1].deadline,null);assert.equal(item.estHours,24);assert.equal(item.subitems[0].estHours,16)})
test('automatic moments follow revised step dates, explicit dates remain fixed and disabled moments are omitted',()=>{const moved=[{...rows[0],endDate:'2026-11-13'}];assert.equal(clientMoment(moved,0,{},true).resolvedDate,'2026-11-13');const settings={[momentKey(rows,0)]:{enabled:true,date:'2026-11-12'}};assert.equal(applyClientMoments({subitems:moved},settings,true).subitems[0].deadline,'2026-11-12');settings[momentKey(rows,0)].enabled=false;assert.equal(applyClientMoments({subitems:moved},settings,true).subitems[0].deadline,null)})
test('duplicate step names remain independently configurable and other templates have no defaults',()=>{const duplicate=[rows[0],rows[0]];assert.notEqual(momentKey(duplicate,0),momentKey(duplicate,1));assert.equal(clientMoment(rows,0,{},false).enabled,false)})
