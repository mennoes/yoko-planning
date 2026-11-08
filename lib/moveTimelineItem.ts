import type { BoardItem } from './boards'
import { itemDatums } from './itemDatums'
export function moveTimelineItem(item: BoardItem, startDate: string, endDate: string, subitemId?: string): BoardItem {
  if (subitemId) return {...item,subitems:item.subitems?.map(sub=>sub.id===subitemId?{...sub,startDate,endDate,datesOverride:true}:sub)}
  const oldStart=itemDatums(item).startDate
  const offset=oldStart?Math.round((Date.parse(startDate)-Date.parse(oldStart))/86400000):0
  const shift=(date:string|null)=>{
    if(!date)return date
    const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset)
    return d.toISOString().slice(0,10)
  }
  return {...item,startDate,endDate,datesOverride:true,subitems:item.subitems?.map(sub=>({
    ...sub,startDate:shift(sub.startDate),endDate:shift(sub.endDate),
    ...(sub.startDate||sub.endDate?{datesOverride:true}:{})
  }))}
}
