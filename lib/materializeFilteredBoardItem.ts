import type { BoardItem, SubItem } from './boards'

type FilteredItem = BoardItem & {
  __prorated?: boolean
  __originalEstHours?: number
}

type FilteredSubItem = SubItem & {
  __originalEstHours?: number
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function cleanSubitem(subitem: FilteredSubItem): SubItem {
  const { __originalEstHours: _discard, ...clean } = subitem
  return clean
}

/**
 * The period-filter renders a temporary, prorated copy of an item. When a
 * different field is edited (for example the timeline), that display copy
 * must never be written back as source data. Merge only the actual edit into
 * the original item and restore untouched hour fields + filtered-out subs.
 */
export function materializeFilteredBoardItem(
  original: BoardItem,
  filteredBefore: BoardItem | undefined,
  updated: BoardItem,
): BoardItem {
  const before = filteredBefore as FilteredItem | undefined
  const edited = updated as FilteredItem
  if (!before?.__prorated && !edited.__prorated) return updated
  const displayedBefore = before ?? edited

  const { __prorated: _prorated, __originalEstHours: _originalHours, ...cleanParent } = edited
  const next: BoardItem = { ...cleanParent }

  // If the displayed prorated number did not change, keep the real source
  // value. A different value means the user deliberately edited Est Time.
  if (Number(edited.estHours ?? 0) === Number(displayedBefore.estHours ?? 0)) {
    next.estHours = Number(original.estHours) || 0
  }
  if (sameJson(edited.ownerHours, displayedBefore.ownerHours)) {
    next.ownerHours = original.ownerHours
  }

  const originalSubs = original.subitems ?? []
  const beforeSubs = (displayedBefore.subitems ?? []) as FilteredSubItem[]
  const updatedSubs = (edited.subitems ?? []) as FilteredSubItem[]
  const beforeById = new Map(beforeSubs.map(sub => [sub.id, sub]))
  const updatedById = new Map(updatedSubs.map(sub => [sub.id, sub]))
  const originalIds = new Set(originalSubs.map(sub => sub.id))

  const mergedSubs: SubItem[] = []
  for (const originalSub of originalSubs) {
    const displayedBefore = beforeById.get(originalSub.id)
    const displayedAfter = updatedById.get(originalSub.id)

    // Not present in the filtered display: it was merely outside the active
    // period and must remain untouched. Present before but absent after means
    // the user actually deleted that visible subitem.
    if (!displayedBefore) {
      mergedSubs.push(originalSub)
      continue
    }
    if (!displayedAfter) continue

    const clean = cleanSubitem(displayedAfter)
    mergedSubs.push({
      ...originalSub,
      ...clean,
      estHours: Number(displayedAfter.estHours ?? 0) === Number(displayedBefore.estHours ?? 0)
        ? Number(originalSub.estHours) || 0
        : Number(displayedAfter.estHours) || 0,
    })
  }

  // Preserve genuinely new subitems created while a period filter is active.
  for (const sub of updatedSubs) {
    if (!originalIds.has(sub.id)) mergedSubs.push(cleanSubitem(sub))
  }
  next.subitems = mergedSubs
  return next
}
