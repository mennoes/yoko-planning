// Tiny global pub-sub so only one popover (workload cell, meeting cluster)
// stays open at a time. Each consumer picks a unique id; opening that id
// broadcasts an event, others listen and close themselves when the active
// id is different.

const EVENT = 'yoko-popover-open'

let activeId: string | null = null

export function openExclusivePopover(id: string) {
  activeId = id
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }))
}

export function closeExclusivePopover(id: string) {
  if (activeId === id) activeId = null
}

export function onExclusivePopoverChange(handler: (activeId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<{ id: string }>
    handler(ce.detail?.id ?? '')
  }
  window.addEventListener(EVENT, wrapped)
  return () => window.removeEventListener(EVENT, wrapped)
}
