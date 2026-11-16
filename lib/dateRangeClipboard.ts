export type CopiedDateRange = {
  startDate: string
  endDate: string
}

const STORAGE_KEY = 'yoko:copied-date-range-v1'
let memoryCopy: CopiedDateRange | null = null

export function normaliseDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): CopiedDateRange | null {
  const first = startDate ?? endDate
  const last = endDate ?? startDate
  if (!first || !last) return null
  return first <= last
    ? { startDate: first, endDate: last }
    : { startDate: last, endDate: first }
}

export function writeCopiedDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): CopiedDateRange | null {
  const value = normaliseDateRange(startDate, endDate)
  if (!value) return null
  memoryCopy = value
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch {}
  return value
}

export function readCopiedDateRange(): CopiedDateRange | null {
  if (memoryCopy) return memoryCopy
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<CopiedDateRange> | null
    memoryCopy = normaliseDateRange(parsed?.startDate, parsed?.endDate)
  } catch {
    memoryCopy = null
  }
  return memoryCopy
}
