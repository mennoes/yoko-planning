import type { BoardGroup } from './boards'
export function changeDeadline(groups: BoardGroup[], itemId:string, subitemId:string|undefined, deadline:string):BoardGroup[] {
  return groups.map(group=>({...group,items:group.items.map(item=>{
    if(item.id!==itemId)return item
    if(subitemId)return {...item,subitems:item.subitems?.map(sub=>sub.id===subitemId?{...sub,deadline,...(sub.source==='google'||item.source==='google'?{deadlineOverride:true}:{})}:sub)}
    return {...item,deadline,...(item.source==='google'?{deadlineOverride:true}:{})}
  })}))
}
