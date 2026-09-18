export function handoffCommentBody(nextName: string, note: string): string {
  const firstName = nextName.trim().split(/\s+/)[0] || nextName.trim()
  return `Overdracht aan @${firstName}\n\n${note.trim()}`
}
