export type AccountLayout = { categories: { id: string; name: string; color: string }[]; assignments: Record<string,string>; order: string[] }
export const DEFAULT_ACCOUNT_LAYOUT: AccountLayout = {
 categories: [
  {id:'design',name:'Ontwerp & animatie',color:'#ad92e8'},
  {id:'ai',name:'AI',color:'#76a8ee'},
  {id:'stock',name:'Muziek & stock',color:'#e8b66c'},
  {id:'files',name:'Bestanden & feedback',color:'#64b9a2'},
  {id:'web',name:'Website & publicatie',color:'#e889a1'},
  {id:'office',name:'Kantoor & toegang',color:'#93a4ba'},
  {id:'other',name:'Overig',color:'#9b9b9b'},
 ], assignments:{},order:[],
}
export function suggestedCategory(name: string): string {
 const n=name.toLowerCase()
 if (/chat\s*gpt|claude|midjourney|openai|runway/.test(n)) return 'ai'
 if (/replay|frame\.io|dropbox|drive/.test(n)) return 'files'
 if (/epidemic|artlist|envato|freepik|sound/.test(n)) return 'stock'
 if (/figma|adobe|cinema|blender/.test(n)) return 'design'
 if (/webflow|instagram|vimeo|mapbox|youtube|hosting/.test(n)) return 'web'
 if (/wifi|remote|desktop|mijnwt|hooghiemstra/.test(n)) return 'office'
 return 'other'
}
export function accountCategory(layout: AccountLayout, account: { id:string; account:string }): string {
 const id=layout.assignments[account.id] ?? suggestedCategory(account.account)
 return layout.categories.some(c=>c.id===id) ? id : 'other'
}
export function moveAccount(layout: AccountLayout, ids: string[], id:string, category:string, before?:string): AccountLayout {
 if (!ids.includes(id) || !layout.categories.some(c=>c.id===category) || id===before) return layout
 const order=[...layout.order.filter(x=>ids.includes(x)),...ids.filter(x=>!layout.order.includes(x))].filter(x=>x!==id)
 const at=before ? order.indexOf(before) : -1
 order.splice(at<0 ? order.length : at,0,id)
 return {...layout,assignments:{...layout.assignments,[id]:category},order}
}
export function readAccountLayout(value: unknown): AccountLayout {
 const v=value as AccountLayout | undefined
 if (!v || !Array.isArray(v.categories) || !v.categories.some(c=>c.id==='other') || !v.categories.every(c=>typeof c.id==='string' && typeof c.name==='string' && /^#[0-9a-f]{6}$/i.test(c.color)) || !Array.isArray(v.order)) return DEFAULT_ACCOUNT_LAYOUT
 return {categories:v.categories,order:[...new Set(v.order.filter(id=>typeof id==='string'))],assignments:Object.fromEntries(Object.entries(v.assignments ?? {}).filter(([,id])=>typeof id==='string'))}
}
