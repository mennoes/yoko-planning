'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { accountCategory, DEFAULT_ACCOUNT_LAYOUT, moveAccount, readAccountLayout, type AccountLayout } from '@/lib/accountLayout'
import type { Account } from '@/lib/accountsStore'

const control: React.CSSProperties = { background:'var(--bg-card)',color:'var(--text-primary)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13 }
export function AccountGroups({ accounts, renderRow, header }: { accounts: Account[]; renderRow:(a:Account,index:number)=>ReactNode; header:ReactNode }) {
 const [layout,setLayout]=useState<AccountLayout>(DEFAULT_ACCOUNT_LAYOUT)
 const [ready,setReady]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [query,setQuery]=useState('')
 const [name,setName]=useState('')
 const [folded,setFolded]=useState<string[]>([])
 const [drag,setDrag]=useState<{kind:'account'|'category';id:string}|null>(null)
 const [over,setOver]=useState<string|null>(null)
 useEffect(()=> { let alive=true; supabase?.auth.getUser().then(({data,error})=> { if(!alive)return; if(error){setError('Indeling kon niet worden geladen. Vernieuw de pagina.');return} setLayout(readAccountLayout(data.user?.user_metadata?.account_layout));setReady(true) });return()=>{alive=false} },[])
 async function save(next:AccountLayout) {
  if(busy || !ready || !supabase)return
  const previous=layout;setLayout(next);setBusy(true);setError('')
  try { const {error}=await supabase.auth.updateUser({data:{account_layout:next}});if(error)throw error }
  catch {setLayout(previous);setError('Indeling niet opgeslagen. Probeer opnieuw.')}
  finally {setBusy(false)}
 }
 function move(id:string,category:string,before?:string){void save(moveAccount(layout,accounts.map(a=>a.id),id,category,before))}
 function drop(category:string,before?:string){
  if(!drag)return
  if(drag.kind==='account')move(drag.id,category,before)
  else if(drag.id!==category){const categories=layout.categories.filter(c=>c.id!==drag.id);const source=layout.categories.find(c=>c.id===drag.id);if(source){categories.splice(categories.findIndex(c=>c.id===category),0,source);void save({...layout,categories})}}
  setDrag(null);setOver(null)
 }
 const ordered=[...accounts].sort((a,b)=>{const rank=(id:string)=>{const n=layout.order.indexOf(id);return n<0 ? layout.order.length+accounts.findIndex(a=>a.id===id):n};return rank(a.id)-rank(b.id)})
 return <div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:20}}>
   <input aria-label="Zoek accounts" placeholder="Zoek een account…" value={query} onChange={e=>setQuery(e.target.value)} style={{...control,flex:'1 1 240px'}} />
   <form onSubmit={e=>{e.preventDefault();if(!name.trim())return;void save({...layout,categories:[...layout.categories,{id:crypto.randomUUID(),name:name.trim(),color:'#76a8ee'}]});setName('')}} style={{display:'flex',gap:6}}>
    <input aria-label="Nieuwe categorie" placeholder="Nieuwe categorie" maxLength={60} value={name} onChange={e=>setName(e.target.value)} style={control}/>
    <button disabled={!name.trim()||busy||!ready} style={control}>+ Categorie</button>
   </form>
  </div>
  <div role="status" style={{fontSize:12,color:error?'var(--red)':'var(--text-muted)',marginBottom:16}}>{error || (busy?'Indeling opslaan…':!ready?'Indeling laden…':`${accounts.length} accounts · Jouw indeling · Sleep via ⠿ of kies een categorie per account`)}</div>
  {layout.categories.map(category=>{
   const all=ordered.filter(a=>accountCategory(layout,a)===category.id)
   const rows=all.filter(a=>[a.account,a.url,a.username,a.licensedBy].some(v=>v.toLowerCase().includes(query.toLowerCase())))
   if(query&&!rows.length)return null
   const collapsed=folded.includes(category.id)&&!query
   return <section key={category.id} aria-label={category.name} onDragOver={e=>{if(drag){e.preventDefault();setOver(category.id)}}} onDrop={e=>{e.preventDefault();drop(category.id)}}
    style={{marginBottom:16,border:`1px solid ${over===category.id?category.color:'var(--border)'}`,borderRadius:14,background:'var(--bg-card)',boxShadow:over===category.id?`0 0 0 2px ${category.color}33`:undefined}}>
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',borderLeft:`4px solid ${category.color}`,borderRadius:'14px 0 0 0'}}>
     <button draggable={ready&&!busy} onDragStart={e=>{e.dataTransfer.setData('text/plain',category.id);setDrag({kind:'category',id:category.id})}} onDragEnd={()=>{setDrag(null);setOver(null)}} title="Categorie verslepen" aria-label={`${category.name} verslepen`} style={{border:0,background:'transparent',color:'var(--text-muted)',cursor:'grab',fontSize:20}}>⠿</button>
     <button aria-label={`${category.name} ${collapsed?'uitklappen':'inklappen'}`} onClick={()=>setFolded(v=>v.includes(category.id)?v.filter(id=>id!==category.id):[...v,category.id])} style={{background:'none',border:0,color:'var(--text-muted)',cursor:'pointer'}}>{collapsed?'▸':'▾'}</button>
     <input key={category.name} aria-label={`Categorienaam ${category.name}`} defaultValue={category.name} disabled={busy||!ready} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==category.name)void save({...layout,categories:layout.categories.map(c=>c.id===category.id?{...c,name}:c)});else e.target.value=category.name}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} style={{width:'min(260px,45vw)',background:'transparent',border:0,color:'var(--text-primary)',fontSize:16,fontWeight:700}}/>
     <span style={{background:category.color+'22',color:category.color,borderRadius:20,padding:'3px 9px',fontSize:12}}>{all.length}</span>
     {category.id!=='other'&&<button disabled={busy||!ready} title="Categorie verwijderen; accounts gaan naar Overig" aria-label={`${category.name} verwijderen`} onClick={()=>{const assignments={...layout.assignments};all.forEach(a=>assignments[a.id]='other');void save({...layout,assignments,categories:layout.categories.filter(c=>c.id!==category.id)})}} style={{marginLeft:'auto',background:'none',border:0,color:'var(--text-muted)',cursor:'pointer'}}>×</button>}
    </div>
    {!collapsed&&<div style={{overflowX:'auto'}}>
     {rows.length>0&&<div style={{minWidth:860}}>{header}{rows.map((a,i)=><div key={a.id} onDragOver={e=>{if(drag?.kind==='account'){e.preventDefault();e.stopPropagation();setOver('row:'+a.id)}}} onDrop={e=>{if(drag?.kind==='account'){e.preventDefault();e.stopPropagation();drop(category.id,a.id)}}} style={{borderTop:over==='row:'+a.id?'2px solid var(--accent)':undefined}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 16px 0'}}>
       <button draggable={ready&&!busy} onDragStart={e=>{e.dataTransfer.setData('text/plain',a.id);setDrag({kind:'account',id:a.id})}} onDragEnd={()=>{setDrag(null);setOver(null)}} aria-label={`${a.account} verslepen`} style={{background:'none',border:0,color:'var(--text-muted)',cursor:'grab',fontSize:18}}>⠿</button>
       <select aria-label={`Categorie van ${a.account}`} disabled={busy||!ready} value={category.id} onChange={e=>move(a.id,e.target.value)} style={{border:0,background:'transparent',color:'var(--text-muted)',fontSize:11}}>{layout.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>{renderRow(a,i)}
     </div>)}</div>}
     {!rows.length&&<div style={{padding:'18px 26px',color:'var(--text-muted)',fontSize:13}}>Sleep hier een account naartoe</div>}
    </div>}
   </section>
  })}
 </div>
}
