'use client'
import {useEffect,useRef,useState,type CSSProperties} from 'react'
import DeadlineFlag from './DeadlineFlag'
export default function DraggableDeadline({date,subitem,label,xForDate,onChange,onOpen,style}:{date:string;subitem:boolean;label:string;xForDate:(date:string)=>number|null;onChange?:(date:string)=>void;onOpen:()=>void;style:CSSProperties}){
 const [preview,setPreview]=useState<string|null>(null)
 const cleanup=useRef<(()=>void)|null>(null)
 const suppress=useRef(false)
 useEffect(()=>()=>cleanup.current?.(),[])
 const x=xForDate(preview??date)
 return <button aria-label={`${label}: ${date}`} title={`${label} · ${date} · sleep om deadline te wijzigen; klik voor details`} onClick={e=>{e.stopPropagation();if(!suppress.current||e.detail===0)onOpen()}} onMouseDown={e=>e.stopPropagation()} onPointerDown={e=>{
   if(e.button!==0||!onChange)return
   e.preventDefault();e.stopPropagation();cleanup.current?.();suppress.current=false
   const start=e.clientX,origin=xForDate(date)
   if(origin===null)return
   let next=date,moved=false
   const move=(event:PointerEvent)=>{
     const dx=event.clientX-start
     if(Math.abs(dx)<3&&!moved)return
     moved=true;suppress.current=true
     let best=date,distance=Math.abs(dx)
     const d=new Date(date+'T12:00:00'),direction=dx<0?-1:1
     for(let i=0;i<3660;i++){
       d.setDate(d.getDate()+direction)
       const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
       const pos=xForDate(iso);if(pos===null)break
       const gap=Math.abs(pos-origin-dx)
       if(gap<distance){best=iso;distance=gap}
       if(direction*(pos-origin-dx)>0)break
     }
     next=best;setPreview(best)
   }
   const clear=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);cleanup.current=null}
   const cancel=()=>{suppress.current=true;clear();setPreview(null)}
   const up=()=>{clear();setPreview(null);if(moved&&next!==date)onChange(next)}
   const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel()}}
   cleanup.current=clear
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel)
 }} style={{...style,left:x??style.left,cursor:preview?'grabbing':'grab',touchAction:'none',zIndex:preview?30:style.zIndex}}>
   <DeadlineFlag subitem={subitem}/>
   {preview&&<span role="status" style={{position:'absolute',top:20,left:0,padding:'4px 6px',borderRadius:4,background:'var(--text-primary)',color:'var(--bg-card)',whiteSpace:'nowrap',fontSize:11,pointerEvents:'none'}}>{new Date(preview+'T12:00:00').toLocaleDateString('nl-NL')}</span>}
 </button>
}
