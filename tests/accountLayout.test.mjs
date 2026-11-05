import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/accountLayout.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const {DEFAULT_ACCOUNT_LAYOUT:l,suggestedCategory,moveAccount,accountCategory,readAccountLayout}=exports

test('known accounts are grouped by use, with replay ahead of Dropbox',()=>{
 for(const [name,category] of [['Replay dropbox','files'],['Chat GPT','ai'],['Figma Vincent','design'],['Epidemic sound','stock'],['WIFI yoko','office'],['Mapbox','web'],['Unknown service','other']]) assert.equal(suggestedCategory(name),category)
})
test('moving an account preserves every account once and respects target position',()=>{
 const next=moveAccount(l,['a','b','c'],'c','ai','a')
 assert.equal(next.order.join(','),'c,a,b')
 assert.equal(next.assignments.c,'ai')
 assert.equal(moveAccount(next,['a','b','c'],'c','ai','c'),next)
})
test('manual categorization wins over automatic suggestion',()=>{
 const next=moveAccount(l,['a'],'a','office')
 assert.equal(accountCategory(next,{id:'a',account:'ChatGPT'}),'office')
})
test('invalid stored layout falls back safely and orphan category uses Other',()=>{
 assert.equal(readAccountLayout(null),l)
 assert.equal(readAccountLayout({categories:[],order:[]}),l)
 assert.equal(accountCategory({...l,assignments:{a:'gone'}},{id:'a',account:'Figma'}),'other')
})
