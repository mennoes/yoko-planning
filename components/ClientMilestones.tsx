'use client'
import { DatumVeld } from './DatumVeld'
import { clientMoment,momentKey,type ClientMoments } from '@/lib/clientMilestones'
export function ClientMilestones({rows,settings,onChange,suggest}:{rows:{name:string;endDate:string|null}[];settings:ClientMoments;onChange:(settings:ClientMoments)=>void;suggest:boolean}) {
 return <div role="tabpanel" aria-label="Klantmomenten" style={{marginTop:12}}>
  <p style={{fontSize:12,color:'var(--text-muted)',margin:'0 0 14px'}}>Wanneer krijgt de klant iets? Aangevinkte momenten worden deadlines op de subitems. Automatische datums volgen het einde van de stap in dit voorstel.</p>
  {!rows.some(row=>row.endDate)&&<p style={{fontSize:12,color:'var(--text-secondary)'}}>Vul een startdatum of deadline in om de datums te zien.</p>}
  <div style={{maxHeight:360,overflowY:'auto'}}>{rows.map((row,index)=>{
   const moment=clientMoment(rows,index,settings,suggest)
   const change=(patch:Partial<typeof moment>)=>onChange({...settings,[momentKey(rows,index)]:{enabled:moment.enabled,date:moment.date,...patch}})
   return <div key={momentKey(rows,index)} style={{marginLeft:7,borderLeft:'2px solid var(--border)',padding:'8px 12px 16px 18px',position:'relative',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
    <span style={{position:'absolute',left:-6,top:18,width:10,height:10,borderRadius:'50%',background:moment.enabled?'var(--accent)':'var(--border)'}}/>
    <label style={{flex:'1 1 180px',fontSize:13,display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={moment.enabled} onChange={e=>change({enabled:e.target.checked})} aria-label={`${row.name} naar klant`}/>{row.name} naar klant</label>
    <DatumVeld value={moment.resolvedDate} onChange={date=>change({date,enabled:true})} ariaLabel={`Klantdatum ${row.name}`}/>
    <button onClick={()=>change({date:null})} title="Volg het einde van de stap" style={{border:0,background:'none',color:'var(--text-muted)',fontSize:11,cursor:'pointer'}}>{moment.date?'Vaste datum · terug naar automatisch':'Automatisch'}</button>
   </div>
  })}</div>
 </div>
}
