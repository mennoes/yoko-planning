import type { BoardItem } from './boards'
export type ClientMoment = { enabled: boolean; date: string | null }
export type ClientMoments = Record<string, ClientMoment>
export function momentKey(rows: {name:string}[], index:number) {
 const name=rows[index].name
 return JSON.stringify([name,rows.slice(0,index).filter(row=>row.name===name).length])
}
export function clientMoment(rows:{name:string;endDate:string|null}[],index:number,settings:ClientMoments,suggest:boolean) {
 const row=rows[index]
 const setting=settings[momentKey(rows,index)] ?? {enabled:suggest&&/^(script|storyboard|vormgeving|animatie|oplevering)$/i.test(row.name.trim()),date:null}
 return {...setting,resolvedDate:setting.date||row.endDate}
}
export function applyClientMoments(item:BoardItem,settings:ClientMoments,suggest:boolean):BoardItem {
 const rows=item.subitems??[]
 return {...item,subitems:rows.map((row,index)=>{const moment=clientMoment(rows,index,settings,suggest);return {...row,deadline:moment.enabled?moment.resolvedDate:null}})}
}
