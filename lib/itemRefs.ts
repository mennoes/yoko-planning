// ─── Item-references: chips die naar een board-item linken ──────────────────
//
// We bewaren refs in tekst-velden als token `#item:<board>:<itemId>` zodat ze
// in elke textarea, todo-titel en (na replace) ook in HTML van pages werken.
// Een aparte renderer (`renderTextWithItemRefs`) splitst tekst in stukken
// en geeft de chip-component voor elke geldige ref.
//
// In de pages-editor wordt bij invoegen direct een <a class="yoko-item-ref">
// element neergezet — daar is de HTML zelf de "rendering". Dat element bevat
// ook `data-itemref="board:id"` zodat we het later weer als token kunnen
// herkennen (bv. voor export).

import { loadGroups, BOARD_NAMES } from './boardStore'
import type { BoardGroup, BoardItem } from './boards'
import { BOARD_COLORS } from './workload'

export type ItemRef = { boardId: string; itemId: string }
export type ItemRefResolved = ItemRef & {
  name:    string
  color:   string
  status:  string
  ownerIds: string[]
  exists:  boolean
}

// `#item:vlaanderen:abc-123` — bord-id mag a-z + '-' bevatten, item-id is
// alfanumeriek + `-`/`_` (zelfde patroon als bestaande board-item ids).
export const ITEM_REF_RE = /#item:([a-z\-]+):([a-zA-Z0-9_\-]+)/g

export function formatItemRef(boardId: string, itemId: string): string {
  return `#item:${boardId}:${itemId}`
}

export function parseItemRefs(text: string): { kind: 'text' | 'ref'; value: string; ref?: ItemRef }[] {
  const out: { kind: 'text' | 'ref'; value: string; ref?: ItemRef }[] = []
  let lastIndex = 0
  // Belangrijk: regex.exec met /g muteert lastIndex — daarom een verse regex
  // per call ipv het exporteer-singleton hergebruiken (anders skip-bugs bij
  // gelijktijdige parses).
  const re = new RegExp(ITEM_REF_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push({ kind: 'text', value: text.slice(lastIndex, m.index) })
    out.push({ kind: 'ref', value: m[0], ref: { boardId: m[1], itemId: m[2] } })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) out.push({ kind: 'text', value: text.slice(lastIndex) })
  return out
}

// Resolve één ref naar volledige info — leest direct uit localStorage zodat
// elke caller (textarea, pages, todos) hetzelfde plaatje krijgt zonder een
// gedeelde React-context te hoeven prikken. Niet super snel bij veel refs,
// maar boards passen comfortabel in geheugen.
export function resolveItemRef(boardId: string, itemId: string): ItemRefResolved {
  const groups: BoardGroup[] = loadGroups(boardId, [])
  const item: BoardItem | undefined = groups.flatMap(g => g.items).find(i => i.id === itemId)
  return {
    boardId,
    itemId,
    name:     item?.name ?? '(verwijderd)',
    color:    BOARD_COLORS[boardId] ?? '#888',
    status:   (item?.status as string) ?? '',
    ownerIds: (item?.ownerIds as string[]) ?? [],
    exists:   !!item,
  }
}

// Voor de picker-popover: één gladde lijst over alle boards heen.
export function loadAllItemsFlat(): ItemRefResolved[] {
  const out: ItemRefResolved[] = []
  for (const boardId of BOARD_NAMES) {
    const groups = loadGroups(boardId, [])
    for (const g of groups) {
      for (const it of g.items) {
        out.push({
          boardId,
          itemId:   it.id,
          name:     it.name,
          color:    BOARD_COLORS[boardId] ?? '#888',
          status:   (it.status as string) ?? '',
          ownerIds: (it.ownerIds as string[]) ?? [],
          exists:   true,
        })
      }
    }
  }
  return out
}

export function itemRefHrefFor(boardId: string, itemId: string): string {
  return `/projects/${boardId}?focus=${encodeURIComponent(itemId)}`
}
