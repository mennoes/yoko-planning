import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const feedback = readFileSync(new URL('../components/FeedbackBubble.tsx', import.meta.url), 'utf8')

test('feedback composer stores optional page and free type as a sentence in the message', () => {
  assert.match(feedback, /feedbackContextPrefix\(draftContext, draftKindLabel\)/)
  assert.match(feedback, /<span>Op<\/span>/)
  assert.match(feedback, /<select value=\{draftContext\}/)
  assert.match(feedback, /draftKindLabel \? 'pagina heb ik een' : 'pagina'/)
  assert.match(feedback, /list="feedback-kind-suggestions"/)
  assert.match(feedback, /`\$\{contextPrefix\}\$\{body\}`/)
})

test('feedback controls are embedded in the composer and context can be removed', () => {
  assert.doesNotMatch(feedback, />Over<\/span>/)
  assert.match(feedback, /Paginacontext uit bericht verwijderen/)
  assert.match(feedback, /setDraftContext\(null\)/)
  assert.match(feedback, /Soort uit bericht verwijderen/)
  assert.match(feedback, /setDraftKindLabel\(null\)/)
  assert.match(feedback, /<textarea value=\{draftBody\}/)
})

test('context controls fit their text and both close buttons are attached', () => {
  assert.match(feedback, /display: 'inline-flex', alignItems: 'stretch', overflow: 'hidden'/)
  assert.match(feedback, /width: `\$\{Math\.max\(8, draftContext\.length \+ 3\)\}ch`/)
  assert.match(feedback, /width: `\$\{Math\.max\(6, draftKindLabel\.length \+ 2\)\}ch`/)
  assert.match(feedback, /borderLeft: '1px solid var\(--border\)'/)
})

test('the sentence is visually an example and the type accepts custom text', () => {
  assert.match(feedback, />Bijv\.<\/span>/)
  assert.match(feedback, /\['Idee', 'Bug', 'Feedback', 'Vraag', 'Wens', 'Opmerking'\]/)
  assert.match(feedback, /\+ soort/)
  assert.doesNotMatch(feedback, /disabled=\{!draftKind/)
})

test('feedback page dropdown uses readable theme colors for options', () => {
  assert.match(feedback, /background: 'var\(--bg-card\)', color: 'var\(--text-primary\)'/)
  assert.match(feedback, /<option[^>]+style=\{\{ background: 'var\(--bg-card\)', color: 'var\(--text-primary\)' \}\}/)
})
