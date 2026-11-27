import type { Project } from '@/lib/workload'
import { dateToWeekPx, type Col, type ZoomLevel } from '@/lib/timelineCols'
import DraggableDeadline from './DraggableDeadline'

export type PlanningDeadlineAnchor = {id:string;parentId?:string;top:number;left:number;right:number}

export default function PlanningDeadlines({projects,cols,zoom,onOpen,onChange,anchors}:{anchors:PlanningDeadlineAnchor[];projects:Project[];cols:Col[];zoom:ZoomLevel;onOpen:(p:Project)=>void;onChange?:(p:Project,date:string)=>void}) {
  if (!cols.length) return null
  const from=cols[0].rangeStart.getTime(), to=cols[cols.length-1].rangeEnd.getTime()+1
  const width=cols.reduce((sum,c)=>sum+c.widthPx,0)
  const seen=new Set<string>()
  const flags:{key:string;x:number;date:string;project:Project;sub:boolean;lane:number}[]=[]
  for(const p of projects){
    const candidates=[{date:p.deadline,project:p,sub:!!p.parentProjectId}]
    if(p.parentDeadline && p.parentProjectId) candidates.push({date:p.parentDeadline,sub:false,project:p.parentProject ?? {...p,id:p.parentProjectId,name:p.parentName??p.name,deadline:p.parentDeadline,parentName:undefined,parentProjectId:undefined,completionSubitemId:undefined}})
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
  const anchorFor=(id:string)=>anchors.find(a=>a.id===id) ?? anchors.filter(a=>a.parentId===id).sort((a,b)=>b.right-a.right)[0]
  const ends:number[]=[]
  flags.sort((a,b)=>a.x-b.x || Number(a.sub)-Number(b.sub))
  for(const flag of flags){let lane=ends.findIndex(end=>end<=flag.x);if(lane<0)lane=ends.length;ends[lane]=flag.x+22;flag.lane=lane}
  return <div aria-label="Deadlines op de bijbehorende items" style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:3000}}>
    {flags.map(flag=>{
      const anchor=anchorFor(flag.project.id)
      if(!anchor)return null
      const samePlaceParent=flag.sub&&flags.some(other=>!other.sub&&Math.abs(other.x-flag.x)<20&&anchorFor(other.project.id)?.id===anchor.id)
      const top=Math.max(0,anchor.top-5)+(samePlaceParent?16:0)
      const edge=Math.max(anchor.left,Math.min(flag.x,anchor.right))
      return <span key={flag.key}>
        {Math.abs(edge-flag.x)>12&&<span aria-hidden style={{position:'absolute',left:Math.min(edge,flag.x),top:top+16,width:Math.abs(edge-flag.x),borderTop:'1px dashed var(--yellow)',opacity:.65,pointerEvents:'none'}}/>}
        <DraggableDeadline date={flag.date} subitem={flag.sub} label={`${flag.sub?'Subitemdeadline':'Projectdeadline'} ${flag.project.name}`} xForDate={date=>{const time=new Date(date+'T00:00:00').getTime();return zoom==='week'?dateToWeekPx(new Date(time),cols[0].rangeStart,cols[0].widthPx):(time-from)/(to-from)*width}} onChange={onChange ? date=>onChange(flag.project,date) : undefined} onOpen={()=>onOpen(flag.project)} style={{position:'absolute',left:flag.x,top,width:22,height:22,padding:2,border:0,background:'transparent',color:'var(--yellow)',pointerEvents:'auto',zIndex:2,filter:'drop-shadow(0 1px 1px rgba(0,0,0,.55))'}}/>
      </span>
    })}
  </div>
}
