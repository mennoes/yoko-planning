'use client'
import { useState, type ReactNode } from 'react'
import type { Account } from '@/lib/accountsStore'
import { IconCopy, IconCheck, IconEye, IconEyeOff, IconKey } from './Icon'

const iconStyle: React.CSSProperties={background:'transparent',border:0,color:'var(--text-muted)',cursor:'pointer',padding:4,display:'inline-flex',borderRadius:6}
function Copy({value,label,password=false}:{value:string;label:string;password?:boolean}) {
 const [copied,setCopied]=useState(false)
 return <button disabled={!value} aria-label={label} title={copied?'Gekopieerd':label} style={iconStyle} onClick={async()=>{try{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1200)}catch{setCopied(false)}}}>{copied?<IconCheck size={14}/>:password?<IconKey size={14}/>:<IconCopy size={14}/>}</button>
}
export function AccountCard({account,handle,categoryPicker,onSave,onDelete}:{account:Account;handle:ReactNode;categoryPicker:ReactNode;onSave:(account:Account)=>Promise<boolean>;onDelete:()=>Promise<void>}) {
 const [editing,setEditing]=useState(false)
 const [draft,setDraft]=useState(account)
 const [revealed,setRevealed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const fields: Array<[keyof Account,string]>=[['account','Naam'],['url','Website'],['username','Gebruikersnaam'],['password','Wachtwoord'],['licensedBy','Licentie van']]
 const safeUrl=/^https?:\/\//i.test(account.url)?account.url:account.url?`https://${account.url}`:''
 return <article style={{padding:'6px 8px',border:'1px solid var(--border-light)',borderRadius:9,background:'var(--bg-base)',minWidth:0}}>
  <div style={{display:'flex',alignItems:'center',gap:6}}>
   {handle}
   <button title="Account bewerken" aria-label={`${account.account} bewerken`} onClick={()=>{setDraft(account);setEditing(!editing);setError('')}} style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'left',fontSize:13,fontWeight:650,color:'var(--text-primary)',background:'none',border:0,padding:0,cursor:'pointer'}}>{account.account}</button>
   {safeUrl&&<a href={safeUrl} target="_blank" rel="noopener noreferrer" aria-label={`${account.account} openen`} title="Website openen" style={{color:'var(--text-muted)',textDecoration:'none',fontSize:15,padding:'0 3px'}}>↗</a>}
  </div>
  <div style={{display:'flex',alignItems:'center',gap:4,marginTop:4,paddingLeft:24}}>
   <span title={account.username} style={{fontSize:11.5,color:'var(--text-secondary)',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',flex:1}}>{account.username||'Geen gebruikersnaam'}</span>
   <Copy value={account.username} label={`Gebruikersnaam van ${account.account} kopiëren`}/>
   <button disabled={!account.password} aria-label={`Wachtwoord van ${account.account} ${revealed?'verbergen':'tonen'}`} style={iconStyle} onClick={()=>setRevealed(!revealed)}>{revealed?<IconEyeOff size={14}/>:<IconEye size={14}/>}</button>
   <Copy password value={account.password} label={`Wachtwoord van ${account.account} kopiëren`}/>
  </div>
  {revealed&&<div style={{fontSize:12,color:'var(--text-secondary)',padding:'4px 0 0 24px',overflowWrap:'anywhere'}}>{account.password}</div>}
  {editing&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(await onSave(draft))setEditing(false);else setError('Opslaan mislukt. Probeer opnieuw.')}catch{setError('Opslaan mislukt. Probeer opnieuw.')}finally{setBusy(false)}}} style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)'}}>
   {fields.map(([key,label])=><label key={key} style={{display:'block',marginBottom:8,fontSize:11,color:'var(--text-muted)'}}>{label}<input aria-label={`${label} van ${account.account}`} type={key==='password'?'password':'text'} required={key==='account'} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})} style={{boxSizing:'border-box',width:'100%',display:'block',marginTop:3,padding:'6px 8px',fontSize:12,color:'var(--text-primary)',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:6}}/></label>)}
   <div style={{margin:'8px 0'}}>{categoryPicker}</div>
   {error&&<p role="alert" style={{fontSize:12,color:'var(--red)'}}>{error}</p>}
   <div style={{display:'flex',gap:6,alignItems:'center'}}>
    <button disabled={busy} style={{padding:'6px 9px',borderRadius:6,border:0,background:'var(--accent)',color:'#171717',fontSize:12,cursor:'pointer'}}>{busy?'Opslaan…':'Opslaan'}</button>
    <button type="button" onClick={()=>setEditing(false)} style={{...iconStyle,fontSize:12}}>Annuleren</button>
    <button type="button" disabled={busy} onClick={()=>void onDelete()} style={{...iconStyle,marginLeft:'auto',fontSize:11,color:'var(--red)'}}>Verwijderen</button>
   </div>
  </form>}
 </article>
}
