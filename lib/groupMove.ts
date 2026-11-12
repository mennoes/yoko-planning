import type { BoardItem } from './boards'

export function isDoneGroupName(name: string): boolean {
  return name.toLowerCase().trim().startsWith('done')
}

/**
 * A manual group move is authoritative for Google meetings. Moving one into
 * a Done group therefore also creates the persistent status override used by
 * the next Google sync; otherwise the meeting would silently become active
 * again after refresh.
 */
export function prepareItemForGroupMove(item: BoardItem, targetGroupName: string): BoardItem {
  if (item.source !== 'google') return item
  if (!isDoneGroupName(targetGroupName)) {
    return { ...item, googlePlacementLocked: true }
  }
  return {
    ...item,
    status: 'Done',
    statusOverride: 'done',
    googlePlacementLocked: true,
  }
}
