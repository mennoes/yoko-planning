import type { SubItem } from './boards'
export type AgendaSort = {key:string;dir:'asc'|'desc'} | null
export function sortSubitems(items: SubItem[], sort: AgendaSort, ownerName: (id: string) => string) {
  if (!sort) return items
  const statuses=['','Working on...','Done','Stuck','Not started','Doorlopend']
  const value=(item:SubItem):string|number|null=>{
    const key=sort.key
    if(key==='name')return item.name.toLowerCase()
    if(key==='owner'||key==='ownerIds')return item.ownerIds?.[0]?ownerName(item.ownerIds[0]).toLowerCase():null
    if(key==='status')return statuses.indexOf(item.status??'')
    if(['timeline','startDate','endDate','deadline','uitzenddag'].includes(key)){
      const raw=key==='timeline'?item.startDate??item.endDate:(item as unknown as Record<string,unknown>)[key]
      return typeof raw==='string'&&raw?raw:null
    }
    const raw=(item as unknown as Record<string,unknown>)[key]
    if(['estHours','dagen','nummers'].includes(key))return Number(raw??0)
    return raw==null?null:typeof raw==='number'?raw:String(raw).toLowerCase()
  }
  return [...items].sort((a,b)=>{
    const av=value(a),bv=value(b)
    if(av===null)return bv===null?0:1
    if(bv===null)return -1
    const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'nl')
    return result*(sort.dir==='asc'?1:-1)
  })
}
