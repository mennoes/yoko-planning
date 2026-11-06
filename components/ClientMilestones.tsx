'use client'
import { DatumVeld } from './DatumVeld'
import { clientMoment,momentKey,type ClientMoments } from '@/lib/clientMilestones'
export function ClientMilestones({rows,settings,onChange,suggest}:{rows:{name:string;endDate:string|null}[];settings:ClientMoments;onChange:(settings:ClientMoments)=>void;suggest:boolean}) {
 return <div role="region" aria-label="Klantmomenten" style={{marginTop:4}}>
  <p style={{fontSize:12,color:'var(--text-muted)',margin:'0 0 8px'}}>Naar de klant · datums volgen de stappen, tenzij je ze vastzet.</p>
  {!rows.some(row=>row.endDate)&&<p style={{fontSize:12,color:'var(--text-secondary)'}}>Vul een startdatum of deadline in om de datums te zien.</p>}
  <div style={{maxHeight:360,overflowY:'auto'}}>{rows.map((row,index)=>{
   const moment=clientMoment(rows,index,settings,suggest)
   const change=(patch:Partial<typeof moment>)=>onChange({...settings,[momentKey(rows,index)]:{enabled:moment.enabled,date:moment.date,...patch}})
   return <div key={momentKey(rows,index)} style={{marginLeft:7,borderLeft:'2px solid var(--border)',padding:'7px 0 10px 14px',position:'relative',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
    <span style={{position:'absolute',left:-6,top:18,width:10,height:10,borderRadius:'50%',background:moment.enabled?'var(--accent)':'var(--border)'}}/>
    <label style={{flex:'1 1 130px',fontSize:13,display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={moment.enabled} onChange={e=>change({enabled:e.target.checked})} aria-label={`${row.name} naar klant`}/>{row.name}</label>
    <DatumVeld style={{width:94,fontSize:12}} value={moment.resolvedDate} onChange={date=>change({date,enabled:true})} ariaLabel={`Klantdatum ${row.name}`}/>
    <button onClick={()=>change({date:null})} title="Volg het einde van de stap" style={{border:0,background:'none',color:'var(--text-muted)',fontSize:10,cursor:'pointer',width:'100%',textAlign:'right'}}>{moment.date?'Vaste datum · automatisch maken':'Automatisch'}</button>
   </div>
  })}</div>
 </div>
}
