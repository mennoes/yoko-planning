export default function DeadlineFlag({subitem=false}:{subitem?:boolean}) {
  return <svg aria-hidden width={subitem ? 13 : 16} height={18} viewBox="0 0 16 18" style={{display:'block',flexShrink:0}}><path d="M3 17V1" stroke="currentColor" strokeWidth={subitem ? 1.4 : 2}/><path d="M3 2H14L11 5L14 8H3Z" fill={subitem ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={subitem ? 1.4 : 1}/></svg>
}
