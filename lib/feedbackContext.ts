import type { FeedbackKind } from './feedbackStore'

export function feedbackKindFromLabel(label: string | null | undefined): FeedbackKind {
  const normalized = (label ?? '').trim().toLocaleLowerCase('nl-NL')
  if (normalized === 'bug') return 'bug'
  if (normalized === 'idee' || normalized === 'ideeën') return 'idee'
  return 'feedback'
}

export function feedbackContextPrefix(
  context: string | null | undefined,
  kindLabel: string | null | undefined,
): string {
  const page = (context ?? '').trim()
  const kind = (kindLabel ?? '').trim().toLocaleLowerCase('nl-NL')
  if (page && kind) return `Op ${page} pagina heb ik een ${kind}… `
  if (page) return `Op ${page} pagina… `
  if (kind) return `Ik heb een ${kind}… `
  return ''
}
