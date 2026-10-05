import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const feedback = readFileSync(new URL('../components/FeedbackBubble.tsx', import.meta.url), 'utf8')

test('feedback composer shows and stores the selected page as the message prefix', () => {
  assert.match(feedback, /`Op \$\{draftContext\} pagina… `/)
  assert.match(feedback, /<span>Op<\/span>/)
  assert.match(feedback, /<select value=\{draftContext \?\? defaultContext\}/)
  assert.match(feedback, /<span>pagina…<\/span>/)
  assert.match(feedback, /`\$\{contextPrefix\}\$\{body\}`/)
})

test('feedback page selector is embedded in the message composer, not in a separate Over row', () => {
  assert.doesNotMatch(feedback, />Over<\/span>/)
  assert.doesNotMatch(feedback, /Paginacontext verwijderen/)
  assert.match(feedback, /<textarea value=\{draftBody\}/)
})

test('feedback page dropdown uses readable theme colors for options', () => {
  assert.match(feedback, /background: 'var\(--bg-card\)', color: 'var\(--text-primary\)'/)
  assert.match(feedback, /<option[^>]+style=\{\{ background: 'var\(--bg-card\)', color: 'var\(--text-primary\)' \}\}/)
})
