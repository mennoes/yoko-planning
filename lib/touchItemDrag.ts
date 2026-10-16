// Slepen met je vinger op de agenda-pagina.
//
// De bestaande drag & drop gebruikt de HTML5 drag-API (dragstart/drop).
// Die bestaat niet op touch: op telefoon en tablet gebeurde er simpelweg
// niets en kon je dus geen item onder een ander item hangen of naar een
// andere groep verplaatsen. Deze laag doet hetzelfde met pointer-events
// en roept exact dezelfde acties aan als de desktopversie.
//
// Hit-testen gaat via document.elementFromPoint + closest() op de
// data-attributen die de tabel al rendert (`data-item-id`,
// `data-group-id`), zodat er geen tweede boekhouding van posities nodig is.

export type TouchDropTarget =
  | { kind: 'nest';  itemId: string }
  | { kind: 'group'; groupId: string }
  | null

type Options = {
  label: string
  /** Item dat gesleept wordt; nooit zijn eigen droptarget. */
  sourceItemId: string
  /** Groep waar het item nu in zit; daarheen verplaatsen is een no-op. */
  sourceGroupId: string
  onDrop: (target: Exclude<TouchDropTarget, null>) => void
  onCancel?: () => void
}

const HIGHLIGHT = '2px solid var(--accent)'
const EDGE_PX = 72
const EDGE_SPEED = 14

function resolveTarget(x: number, y: number, sourceItemId: string, sourceGroupId: string): TouchDropTarget {
  // elementsFromPoint (meervoud) i.p.v. elementFromPoint: bovenop een rij
  // liggen sticky kolommen en overlays die zélf geen rij-ancestor hebben.
  // Met alleen het bovenste element kreeg je dan geen enkel droptarget.
  const stack = document.elementsFromPoint(x, y)
  const row = stack.map(el => el.closest<HTMLElement>('[data-item-id]')).find(Boolean) ?? null
  if (row && row.dataset.itemId && row.dataset.itemId !== sourceItemId) {
    // Zelfde zone-indeling als op desktop: in het midden van een rij
    // nestelen, aan de randen bedoel je de groep eromheen.
    const rect = row.getBoundingClientRect()
    const offset = y - rect.top
    if (offset > rect.height * 0.25 && offset < rect.height * 0.75) {
      return { kind: 'nest', itemId: row.dataset.itemId }
    }
  }
  const group = stack.map(el => el.closest<HTMLElement>('[data-group-id]')).find(Boolean) ?? null
  const groupId = group?.dataset.groupId
  if (groupId && groupId !== sourceGroupId) return { kind: 'group', groupId }
  return null
}

function elementFor(target: Exclude<TouchDropTarget, null>): HTMLElement | null {
  const selector = target.kind === 'nest'
    ? `[data-item-id="${CSS.escape(target.itemId)}"]`
    : `[data-group-id="${CSS.escape(target.groupId)}"]`
  return document.querySelector<HTMLElement>(selector)
}

/** Start een sleepactie vanaf een al ingedrukte vinger. Geeft een
 *  opruim-functie terug voor het geval de aanroeper zelf wil stoppen. */
export function startTouchItemDrag(event: PointerEvent, options: Options): () => void {
  const ghost = document.createElement('div')
  ghost.textContent = options.label
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    position: 'fixed', zIndex: '9999', pointerEvents: 'none',
    padding: '6px 10px', borderRadius: '8px', maxWidth: '60vw',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    background: 'var(--accent)', color: '#fff',
    fontSize: '13px', fontWeight: '650',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
    transform: 'translate(-50%, -140%)',
  } satisfies Partial<CSSStyleDeclaration>)
  ghost.style.left = `${event.clientX}px`
  ghost.style.top = `${event.clientY}px`
  document.body.appendChild(ghost)

  const previousUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'

  let highlighted: HTMLElement | null = null
  let highlightedOutline = ''
  let target: TouchDropTarget = null
  let edgeTimer: number | undefined

  function clearHighlight() {
    if (highlighted) highlighted.style.outline = highlightedOutline
    highlighted = null
    highlightedOutline = ''
  }

  function highlight(next: TouchDropTarget) {
    const element = next ? elementFor(next) : null
    if (element === highlighted) return
    clearHighlight()
    if (!element) return
    highlighted = element
    highlightedOutline = element.style.outline
    element.style.outline = HIGHLIGHT
  }

  // Automatisch meescrollen bij de boven- en onderrand: zonder dit kun je
  // op een telefoon alleen binnen het zichtbare stukje lijst slepen.
  function autoScroll(y: number) {
    window.clearInterval(edgeTimer)
    const distanceTop = y
    const distanceBottom = window.innerHeight - y
    const delta = distanceTop < EDGE_PX ? -EDGE_SPEED : distanceBottom < EDGE_PX ? EDGE_SPEED : 0
    if (delta === 0) return
    edgeTimer = window.setInterval(() => window.scrollBy(0, delta), 16)
  }

  function onMove(move: PointerEvent) {
    move.preventDefault()
    ghost.style.left = `${move.clientX}px`
    ghost.style.top = `${move.clientY}px`
    target = resolveTarget(move.clientX, move.clientY, options.sourceItemId, options.sourceGroupId)
    highlight(target)
    autoScroll(move.clientY)
  }

  function finish(commit: boolean) {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.clearInterval(edgeTimer)
    clearHighlight()
    ghost.remove()
    document.body.style.userSelect = previousUserSelect
    if (commit && target) options.onDrop(target)
    else options.onCancel?.()
  }

  function onUp() { finish(true) }
  function onCancel() { finish(false) }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  return () => finish(false)
}
