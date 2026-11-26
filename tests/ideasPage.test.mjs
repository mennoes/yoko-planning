import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('app/ideas/page.tsx', 'utf8')
const store = fs.readFileSync('lib/ideasStore.ts', 'utf8')
const sidebar = fs.readFileSync('components/Sidebar.tsx', 'utf8')
const shell = fs.readFileSync('components/AppShell.tsx', 'utf8')
const migration = fs.readFileSync('supabase/0044_ideas.sql', 'utf8')

test('ideas page is a visual inspiration wall rather than a checkbox list', () => {
  assert.match(page, /<h1>Ideeën<\/h1>/)
  assert.match(page, /IconIdea/)
  assert.doesNotMatch(page, /Yoko ideeënmuur|Een goed idee hoeft nog geen taak te zijn/)
  assert.match(page, /Verras me/)
  assert.match(page, /Pak op →/)
  assert.doesNotMatch(page, /type="checkbox"/)
})

test('ideas page supports categories, colors and progress', () => {
  for (const category of ['inspiratie', 'tussendoor', 'experiment', 'verbetering']) {
    assert.match(page, new RegExp(category))
  }
  assert.match(page, /COLORS/)
  assert.match(page, /status: 'doing'/)
  assert.match(page, /status: 'done'/)
})

test('ideas are shared through their own realtime store with a local cache', () => {
  assert.match(store, /from\('ideas'\)/)
  assert.match(store, /supabase\.channel\('ideas'\)/)
  assert.match(store, /yoko-ideas-v1/)
})

test('ideas is a first-class page in navigation and browser history', () => {
  assert.match(sidebar, /href: '\/ideas'/)
  assert.match(sidebar, /'\/ideas':\s+IconIdea/)
  assert.match(shell, /root === 'ideas'/)
  assert.match(shell, /'\/ideas'/)
})

test('ideas migration enables RLS and explicit Data API grants', () => {
  assert.match(migration, /enable row level security/)
  assert.match(migration, /grant select on public\.ideas to anon/)
  assert.match(migration, /grant select, insert, update, delete on public\.ideas to authenticated/)
  assert.match(migration, /grant select, insert, update, delete on public\.ideas to service_role/)
})
