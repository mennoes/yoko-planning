import type { Project } from '@/lib/workload'
import { dateToWeekPx, type Col, type ZoomLevel } from '@/lib/timelineCols'
import DeadlineFlag from './DeadlineFlag'

export default function PlanningDeadlines({projects,cols,zoom,onOpen}:{projects:Project[];cols:Col[];zoom:ZoomLevel;onOpen:(p:Project)=>void}) {
  if (!cols.length) return null
  const from=cols[0].rangeStart.getTime(), to=cols[cols.length-1].rangeEnd.getTime()+1
  const width=cols.reduce((sum,c)=>sum+c.widthPx,0)
  const seen=new Set<string>()
  const flags:{key:string;x:number;date:string;project:Project;sub:boolean;lane:number}[]=[]
  for(const p of projects){
    const candidates=[{date:p.deadline,project:p,sub:!!p.parentProjectId}]
    if(p.parentDeadline && p.parentProjectId) candidates.push({date:p.parentDeadline,sub:false,project:{...p,id:p.parentProjectId,name:p.parentName??p.name,deadline:p.parentDeadline,parentName:undefined,parentProjectId:undefined,completionSubitemId:undefined}})
    for(const entry of candidates){
      if(!entry.date)continue
      const time=new Date(entry.date+'T00:00:00').getTime()
      const key=entry.project.id+':'+entry.date
      if(!Number.isFinite(time)||time<from||time>=to||seen.has(key))continue
      seen.add(key)
      const x=zoom==='week'?dateToWeekPx(new Date(time),cols[0].rangeStart,cols[0].widthPx):(time-from)/(to-from)*width
      flags.push({key,x,date:entry.date,project:entry.project,sub:entry.sub,lane:0})
    }
  }
  if(!flags.length)return null
  const ends:number[]=[]
  flags.sort((a,b)=>a.x-b.x || Number(a.sub)-Number(b.sub))
  for(const flag of flags){let lane=ends.findIndex(end=>end<=flag.x);if(lane<0)lane=ends.length;ends[lane]=flag.x+22;flag.lane=lane}
  return <div aria-label="Deadlines: volle vlag voor project, open vlag voor subitem" style={{position:'relative',height:ends.length*20+2,width,minWidth:width,background:'var(--overlay-faint)'}}>
    {flags.map(flag=><button key={flag.key} onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpen(flag.project)}} title={`${flag.sub?'Subitemdeadline':'Projectdeadline'} · ${flag.project.name} · ${new Date(flag.date+'T12:00:00').toLocaleDateString('nl-NL')} · open details`} aria-label={`${flag.sub?'Subitemdeadline':'Projectdeadline'} ${flag.project.name}: ${flag.date}`} style={{position:'absolute',left:Math.max(0,Math.min(width-20,flag.x)),top:flag.lane*20,width:20,height:20,padding:1,border:0,background:'transparent',color:'var(--yellow)',cursor:'pointer'}}><DeadlineFlag subitem={flag.sub}/></button>)}
  </div>
}
