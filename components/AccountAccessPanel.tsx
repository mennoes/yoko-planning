'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ACCOUNT_TEAM_ROLES, type AccountTeamRole } from '@/lib/accountAccess'
type AccessUser = { id: string; email: string; role: AccountTeamRole; allowed: boolean; admin: boolean }
const control: React.CSSProperties = { background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }
export function AccountAccessPanel() {
 const [users,setUsers]=useState<AccessUser[]>([])
 const [error,setError]=useState('')
 const [busy,setBusy]=useState<string|null>('loading')
 async function request(method: string, body?: unknown) {
  const {data}=await supabase!.auth.getSession()
  const response=await fetch('/api/accounts/access',{method,headers:{Authorization:`Bearer ${data.session?.access_token ?? ''}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
  const result=await response.json()
  if(!response.ok)throw new Error(result.error || 'Toegang kon niet worden geladen.')
  return result
 }
 useEffect(()=>{let active=true;request('GET').then(data=>{if(active)setUsers(data.users)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(null)});return()=>{active=false}},[])
 async function save(user: AccessUser) {
  setBusy(user.id);setError('')
  try {await request('PATCH',{userId:user.id,role:user.role,allowed:user.allowed});setUsers(current=>current.map(u=>u.id===user.id?user:u))}
  catch(e){setError(e instanceof Error?e.message:'Opslaan mislukt.')}
  finally{setBusy(null)}
 }
 return <section aria-label="Toegang tot accounts" style={{marginBottom:20,padding:16,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg-card)'}}>
  <h2 style={{fontSize:15,margin:'0 0 5px'}}>Toegang tot accounts</h2>
  <p style={{fontSize:12,color:'var(--text-muted)',margin:'0 0 12px'}}>Per persoonlijke login. Stage geeft standaard geen toegang; je kunt dit per persoon aanpassen.</p>
  {error&&<p role="alert" style={{color:'var(--red)',fontSize:12}}>{error}</p>}
  {busy==='loading'&&<p>Laden…</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,400px),1fr))',gap:8}}>
  {users.map(user=><div key={user.id} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,padding:9,background:'var(--bg-base)',borderRadius:8}}>
   <span style={{flex:'1 1 170px',fontSize:12,overflowWrap:'anywhere'}}>{user.email}</span>
   {user.admin?<span style={{fontSize:12,color:'var(--text-muted)'}}>Beheerder · toegang</span>:<>
    <select aria-label={`Functie van ${user.email}`} value={user.role} disabled={!!busy} style={control} onChange={e=>{const role=e.target.value as AccountTeamRole;void save({...user,role,allowed:role==='team'?user.allowed:false})}}>{Object.entries(ACCOUNT_TEAM_ROLES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}><input type="checkbox" aria-label={`Accounts bekijken voor ${user.email}`} checked={user.allowed} disabled={!!busy} onChange={e=>void save({...user,allowed:e.target.checked})}/>Accounts bekijken</label>
   </>}
  </div>)}
  </div>
 </section>
}
