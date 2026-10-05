import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const feedback = readFileSync(new URL('../components/FeedbackBubble.tsx', import.meta.url), 'utf8')

test('feedback composer stores page and feedback type as a sentence in the message', () => {
  assert.match(feedback, /`Op \$\{draftContext\} pagina heb ik een \$\{kindInSentence\}… `/)
  assert.match(feedback, /<span>Op<\/span>/)
  assert.match(feedback, /<select value=\{draftContext\}/)
  assert.match(feedback, /<span>pagina heb ik een<\/span>/)
  assert.match(feedback, /<select value=\{draftKind\}/)
  assert.match(feedback, /`\$\{contextPrefix\}\$\{body\}`/)
})

test('feedback controls are embedded in the composer and context can be removed', () => {
  assert.doesNotMatch(feedback, />Over<\/span>/)
  assert.match(feedback, /Paginacontext uit bericht verwijderen/)
  assert.match(feedback, /setDraftContext\(null\)/)
  assert.match(feedback, /<textarea value=\{draftBody\}/)
})

test('feedback page dropdown uses readable theme colors for options', () => {
  assert.match(feedback, /background: 'var\(--bg-card\)', color: 'var\(--text-primary\)'/)
  assert.match(feedback, /<option[^>]+style=\{\{ background: 'var\(--bg-card\)', color: 'var\(--text-primary\)' \}\}/)
})
