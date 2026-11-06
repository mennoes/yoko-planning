'use client'
import { DatumVeld } from './DatumVeld'
import { clientMoment,momentKey,type ClientMoments } from '@/lib/clientMilestones'
import type { SjabloonStap } from '@/lib/sjabloonPlan'
export function PlannerStepTable({steps,dates,settings,onChange,onSettings,suggest,datesReady}:{steps:SjabloonStap[];dates:{name:string;endDate:string|null}[];settings:ClientMoments;onChange:(steps:SjabloonStap[])=>void;onSettings:(settings:ClientMoments)=>void;suggest:boolean;datesReady:boolean}) {
 const rows=steps.map((s,i)=>({name:s.naam,endDate:dates[i]?.endDate??null}))
 function edit(index:number,patch:Partial<SjabloonStap>) {
  const next=steps.map((s,i)=>i===index?{...s,...patch}:s)
  const nextRows=next.map(s=>({name:s.naam}))
  const remapped:ClientMoments={}
  rows.forEach((_,i)=>{const setting=settings[momentKey(rows,i)];if(setting)remapped[momentKey(nextRows,i)]=setting})
  onSettings(remapped);onChange(next)
 }
 const field={width:'100%',minWidth:0,boxSizing:'border-box' as const,background:'transparent',color:'var(--text-primary)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 7px',fontSize:12}
 return <div style={{marginTop:10,border:'1px solid var(--border)',borderRadius:9,overflow:'hidden'}}>
  <div style={{maxHeight:420,overflowY:'auto'}}><table aria-label="Stappen met dagen en deadline" style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
   <colgroup><col/><col style={{width:85}}/><col style={{width:170}}/><col style={{width:34}}/></colgroup>
   <thead><tr>{['Stap','Dagen','Deadline',''].map((label,i)=><th key={i} style={{textAlign:'left',padding:'7px 10px',fontSize:11,color:'var(--text-muted)',background:'var(--bg-card)',position:'sticky',top:0,zIndex:1}}>{label}</th>)}</tr></thead>
   <tbody>{rows.map((row,index)=>{const moment=clientMoment(rows,index,settings,suggest);return <tr key={momentKey(rows,index)} style={{borderTop:'1px solid var(--border)'}}>
    <td style={{padding:'3px 10px'}}><input key={row.name} aria-label={`Stap ${index+1}`} defaultValue={row.name} style={field} onBlur={e=>{const name=e.target.value.trim();if(name)edit(index,{naam:name});else e.target.value=row.name}}/></td>
    <td style={{padding:'3px 6px',opacity:datesReady?1:0.45,background:datesReady?'var(--bg-hover)':'transparent',transition:'background .2s, opacity .2s'}}><input key={steps[index].dagen} aria-label={`Dagen ${row.name}`} type="number" min={1} max={365} defaultValue={steps[index].dagen} style={field} onBlur={e=>{const days=Math.max(1,Math.min(365,Math.round(Number(e.target.value)||1)));e.target.value=String(days);edit(index,{dagen:days})}}/></td>
    <td style={{padding:'3px 10px',opacity:datesReady?1:0.45,background:datesReady?'var(--bg-hover)':'transparent',transition:'background .2s, opacity .2s'}}><DatumVeld disabled={!datesReady} title={datesReady?'Deadline voor de klant':'Vul eerst de deadline bovenaan in'} value={datesReady && moment.enabled?moment.resolvedDate:null} ariaLabel={`Deadline ${row.name}`} style={{...field,width:125}} onChange={date=>onSettings({...settings,[momentKey(rows,index)]:{enabled:!!date,date}})}/></td>
    <td><button aria-label={`${row.name} verwijderen`} onClick={()=>{const next=steps.filter((_,i)=>i!==index);const nextRows=next.map(s=>({name:s.naam}));const remapped:ClientMoments={};let j=0;rows.forEach((_,i)=>{if(i===index)return;const setting=settings[momentKey(rows,i)];if(setting)remapped[momentKey(nextRows,j)]=setting;j++});onSettings(remapped);onChange(next)}} style={{background:'none',border:0,color:'var(--text-muted)',cursor:'pointer'}}>×</button></td>
   </tr>})}</tbody>
  </table></div>
  <button onClick={()=>onChange([...steps,{naam:'Nieuwe stap',dagen:1}])} style={{margin:7,padding:'6px 10px',border:0,borderRadius:6,background:'var(--bg-hover)',color:'var(--text-secondary)',fontSize:12,cursor:'pointer'}}>+ Stap</button>
 </div>
}
