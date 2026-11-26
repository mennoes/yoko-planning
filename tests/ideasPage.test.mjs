import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('app/ideas/page.tsx', 'utf8')
const store = fs.readFileSync('lib/ideasStore.ts', 'utf8')
const sidebar = fs.readFileSync('components/Sidebar.tsx', 'utf8')
const shell = fs.readFileSync('components/AppShell.tsx', 'utf8')
const migration = fs.readFileSync('supabase/0044_ideas.sql', 'utf8')
const goalsMigration = fs.readFileSync('supabase/0045_idea_goals_and_custom_categories.sql', 'utf8')

test('ideas page is a visual inspiration wall rather than a checkbox list', () => {
  assert.match(page, /<h1>Ideeën<\/h1>/)
  assert.match(page, /IconIdea/)
  assert.doesNotMatch(page, /Yoko ideeënmuur|Een goed idee hoeft nog geen taak te zijn/)
  assert.match(page, /Verras me/)
  assert.match(page, /aria-label="Ik pak dit idee op"/)
  assert.doesNotMatch(page, /type="checkbox"/)
})

test('ideas page supports categories, colors and progress', () => {
  for (const category of ['inspiratie', 'tussendoor', 'experiment', 'verbetering']) {
    assert.match(page, new RegExp(category))
  }
  assert.match(page, /COLORS/)
  assert.match(page, /status: 'doing'/)
  assert.match(page, /status: 'done'/)
  assert.match(page, /<span>Status<\/span>/)
  assert.match(page, /Open en bezig/)
  assert.match(page, /<option value="doing">Wordt opgepakt/)
  assert.match(page, /<option value="done">Klaar/)
  assert.doesNotMatch(page, /setFilter\('doing'\)|setFilter\('done'\)/)
})

test('a new idea can introduce a reusable custom category', () => {
  assert.match(page, /Eigen categorie toevoegen/)
  assert.match(page, /const \[newCategory, setNewCategory\]/)
  assert.match(page, /const categoryOptions = useMemo/)
  assert.match(page, /ideas\.map\(idea => idea\.category\.trim\(\)\)/)
  assert.match(page, /category: selectedCategory/)
  assert.match(store, /category: row\.category\?\.trim\(\) \|\| 'inspiratie'/)
  assert.match(goalsMigration, /drop constraint if exists ideas_category_check/)
})

test('ideas explain which larger goal they contribute to', () => {
  assert.match(page, /idea\.goal && <div className=\{styles\.noteGoal\}/)
  assert.match(page, /title=\{`Doel: \$\{idea\.goal\}`\}/)
  assert.match(page, /Nieuw doel toevoegen/)
  assert.match(page, /const goalOptions = useMemo/)
  assert.match(store, /goal: row\.goal\?\.trim\(\) \?\? ''/)
  assert.match(goalsMigration, /add column if not exists goal text not null default ''/)
})

test('post-its can be moved playfully without turning a drag into an edit', () => {
  assert.match(page, /yoko-ideas-positions-v1/)
  assert.match(page, /onPointerDown=\{event => startNoteDrag\(event, idea\.id\)\}/)
  assert.match(page, /aria-label=\{`\$\{idea\.title\} verplaatsen`\}/)
  assert.match(page, /window\.addEventListener\('pointermove', onMove\)/)
  assert.match(page, /localStorage\.setItem\(POSITIONS_KEY/)
  assert.match(page, /event\.stopPropagation\(\)/)
})

test('ideas live on a pannable and zoomable free canvas', () => {
  assert.match(page, /yoko-ideas-canvas-view-v1/)
  assert.match(page, /onPointerDown=\{startCanvasPan\}/)
  assert.match(page, /onWheel=\{handleCanvasWheel\}/)
  assert.match(page, /scale\(\$\{canvasView\.zoom\}\)/)
  assert.match(page, /\/ canvasView\.zoom/)
  assert.match(page, /Math\.max\(\.45, Math\.min\(1\.8/)
  assert.match(page, /Sleep de lege ruimte om rond te kijken/)
})

test('ideas are shared through their own realtime store with a local cache', () => {
  assert.match(store, /from\('ideas'\)/)
  assert.match(store, /supabase\.channel\('ideas'\)/)
  assert.match(store, /yoko-ideas-v1/)
  assert.match(store, /yoko-ideas-remote-bootstrap-v1/)
  assert.match(store, /const missing = local\.filter\(item => !remoteIds\.has\(item\.id\)\)/)
  assert.match(store, /localStorage\.setItem\(REMOTE_BOOTSTRAP_KEY, 'done'\)/)
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
