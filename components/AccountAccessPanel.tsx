'use client'
import { useAccountPermissions } from '@/lib/useAccountPermissions'
import { AccountRoleControl } from './AccountRoleControl'
export function AccountAccessPanel() {
 const {users,error,loading,saving,save}=useAccountPermissions()
 return <section aria-label="Toegang tot accounts" style={{marginBottom:20,padding:16,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg-card)'}}>
  <h2 style={{fontSize:15,margin:'0 0 5px'}}>Toegang tot accounts</h2>
  <p style={{fontSize:12,color:'var(--text-muted)',margin:'0 0 12px'}}>Nieuwe logins hebben standaard geen toegang. Productiestagiairs en onderzoeksstagiairs zijn altijd uitgesloten.</p>
  {error&&<p role="alert" style={{color:'var(--red)',fontSize:12}}>{error}</p>}
  {loading&&<p>Laden…</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,400px),1fr))',gap:8}}>
  {users.map(user=><div key={user.id} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,padding:9,background:'var(--bg-base)',borderRadius:8}}>
   <span style={{flex:'1 1 170px',fontSize:12,overflowWrap:'anywhere'}}>{user.email}</span>
   <div style={{width:170}}><AccountRoleControl user={user} name={user.email} busy={!!saving} onSave={save}/></div>
  </div>)}
  </div>
 </section>
}
