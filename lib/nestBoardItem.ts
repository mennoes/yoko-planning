import type { BoardItem, SubItem } from './boards'

export function nestedSubitemId(sourceId: string, nonce: number): string {
  return `si_nested_${sourceId}_${nonce}`
}

/** Convert a top-level item into an independently identified subitem. */
export function boardItemToNestedSubitem(source: BoardItem, nonce = Date.now()): SubItem {
  const childHours = (source.subitems ?? []).reduce((sum, child) => sum + (Number(child.estHours) || 0), 0)
  const ownHours = Number(source.estHours) || 0
  return {
    id: nestedSubitemId(source.id, nonce),
    sourceItemId: source.id,
    name: source.name,
    ownerIds: source.ownerIds ?? [],
    status: source.status ?? '',
    startDate: source.startDate ?? null,
    endDate: source.endDate ?? null,
    startTime: (source as { startTime?: string | null }).startTime ?? null,
    endTime: (source as { endTime?: string | null }).endTime ?? null,
    externalLink: source.externalLink ?? null,
    meetLink: (source as { meetLink?: string | null }).meetLink ?? null,
    source: source.source,
    estHours: ownHours + childHours,
    nestedSource: source.subitems?.length
      ? { estHours: ownHours, subitems: source.subitems.map(child => ({ ...child })) }
      : undefined,
  }
}
