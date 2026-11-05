import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
function module(path, require = () => ({})) {
 const exports = {}
 runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,Response})
 return exports
}
const permissions=module('../lib/accountAccess.ts')
function route(actor, target={id:'target',app_metadata:{provider:'email'}}, invalid=false) {
 const saved=[]
 const admin={auth:{getUser:async()=>({data:{user:actor},error:invalid?{}:null}),admin:{
  listUsers:async()=>({data:{users:[target]},error:null}),
  getUserById:async()=>({data:{user:target},error:null}),
  updateUserById:async(id,data)=>{saved.push({id,data});return {error:null}},
 }}}
 return {saved,...module('../app/api/accounts/access/route.ts',p=>p==='@/lib/supabaseAdmin'?{supabaseAdmin:admin}:p==='@/lib/accountAccess'?permissions:{})}
}
function request(body,token='valid') {return {headers:new Headers(token?{authorization:`Bearer ${token}`} : {}),json:async()=>body}}
test('access defaults closed and requires boolean server-managed flags',()=>{
 for(const m of [undefined,{}, {accounts_access:'true'}, {team_role:'team'}])assert.equal(permissions.accountAccess(m),false)
 assert.equal(permissions.accountAccess({accounts_access:true,team_role:'team'}),true)
})
test('unauthenticated and forged-user-metadata administrators cannot read or write access',async()=>{
 const r=route({id:'intern',user_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'},app_metadata:{}})
 assert.equal((await r.GET(request(null,''))).status,401)
 assert.equal((await r.GET(request(null))).status,403)
 assert.equal((await r.PATCH(request({userId:'intern',role:'team',allowed:true}))).status,403)
 assert.equal(r.saved.length,0)
 const invalid=route({app_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'}},undefined,true)
 assert.equal((await invalid.GET(request(null))).status,401)
})
test('only an authorized administrator can change a regular login, preserving unrelated metadata',async()=>{
 const r=route({id:'admin',app_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'}})
 assert.equal((await r.PATCH(request({userId:'target',role:'production_intern',allowed:false}))).status,200)
 assert.equal(r.saved[0].data.app_metadata.provider,'email')
 assert.equal(r.saved[0].data.app_metadata.accounts_access,false)
 assert.equal(r.saved[0].data.app_metadata.team_role,'production_intern')
 assert.equal(r.saved[0].data.app_metadata.accounts_admin,undefined)
})
test('invalid roles and changes to administrator logins are rejected',async()=>{
 const r=route({app_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'}},{id:'admin',app_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'}})
 assert.equal((await r.PATCH(request({userId:'admin',role:'team',allowed:false}))).status,403)
 assert.equal((await r.PATCH(request({userId:'target',role:'owner',allowed:true}))).status,400)
 assert.equal(r.saved.length,0)
})

test('new logins and both internship roles remain denied even with a stale allow flag',async()=>{
 for(const role of [undefined, 'production_intern','research_intern','unknown']){
  assert.equal(permissions.accountAccess({accounts_access:true,team_role:role}),false)
  assert.equal(permissions.accountAccessAdmin({accounts_admin:true,accounts_access:true,team_role:role}),false)
 }
 const r=route({app_metadata:{accounts_admin:true,accounts_access:true,team_role:'team'}})
 for(const role of ['production_intern','research_intern']) assert.equal((await r.PATCH(request({userId:'target',role,allowed:true}))).status,400)
 assert.equal(r.saved.length,0)
})
