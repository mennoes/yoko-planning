'use client'
import { ACCOUNT_TEAM_ROLES, type AccountTeamRole } from '@/lib/accountAccess'
import type { AccessUser } from '@/lib/useAccountPermissions'
export function AccountRoleControl({user,name,busy,onSave}:{user:AccessUser;name:string;busy:boolean;onSave:(user:AccessUser)=>Promise<boolean>}) {
 if(user.admin)return <span style={{fontSize:12,color:'var(--text-muted)'}}>Beheerder · toegang</span>
 return <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6}}>
  <select aria-label={`Functie van ${name}`} title={`Login: ${user.email}`} value={user.role} disabled={busy} style={{width:'100%',background:'var(--bg-base)',color:'var(--text-primary)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 6px',fontSize:12}} onChange={e=>{const role=e.target.value as AccountTeamRole;void onSave({...user,role,allowed:role==='team'?user.allowed:false})}}>
   {Object.entries(ACCOUNT_TEAM_ROLES).map(([value,label])=><option key={value} value={value}>{label}</option>)}
  </select>
  <label style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--text-muted)'}} title={user.role!=='team'?'Stagiairs hebben automatisch geen toegang tot accounts':'Toegang tot de gedeelde accounts'}>
   <input type="checkbox" aria-label={`Accounts bekijken voor ${name}`} checked={user.allowed} disabled={busy||user.role!=='team'} onChange={e=>void onSave({...user,allowed:e.target.checked})}/>Accounts bekijken
  </label>
 </div>
}
