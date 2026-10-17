import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const drawer = readFileSync(new URL('../components/BoardTrashDrawer.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')

test('het heet geen Geschiedenis meer maar Activiteit', () => {
  assert.doesNotMatch(board, />Geschiedenis</)
  assert.doesNotMatch(board, /'Geschiedenis'/)
  assert.match(board, /\{isMobile \? '' : 'Activiteit'\}/)
  assert.match(drawer, />Activiteit<\/h2>/)
})

test('elke regel heeft dezelfde kolommen: wat, wie, wanneer, actie', () => {
  assert.match(drawer, /function LogRow\(\{ tone, icon, title, titleNote, body, context, actor, ts, actions, onClick \}/)
  // Wie en wanneer staan rechts, in vaste kolommen naast elkaar.
  assert.match(drawer, /\{\/\* Kolom 2 — door wie \*\/\}/)
  assert.match(drawer, /\{\/\* Kolom 3 — wanneer/)
  assert.match(drawer, /\{\/\* Kolom 4 — wat je ermee kunt \*\/\}/)
  // Exacte tijd in de tooltip; relatieve tijd in beeld.
  assert.match(drawer, /title=\{fmtDate\(ts\)\}/)
  // Zowel verwijderingen als wijzigingen gebruiken dezelfde rij.
  assert.equal((drawer.match(/<LogRow/g) ?? []).length, 2)
})

test('de regel vertelt waar het stond: agenda, groep en hoofditem', () => {
  assert.match(drawer, /const \[itemContextById, setItemContextById\] = useState<Record<string, ItemContext>>/)
  assert.match(drawer, /ctx\?\.parentName \? `onder '\$\{ctx\.parentName\}'` : null/)
  assert.match(drawer, /context=\{\[boardTitle, t\.groupName \?\? null\]\.filter\(Boolean\)\.join\(' · '\)\}/)
  // Een subitem is als zodanig herkenbaar.
  assert.match(drawer, /titleNote=\{isSubitem \? 'subitem' : null\}/)
})

test('van → naar blijft het hart van elke wijziging', () => {
  assert.match(drawer, /<OwnerChangePill before=\{e\.meta\?\.before\} after=\{e\.meta\?\.after\} getPhoto=\{getPhoto\}/)
  assert.match(drawer, /<span style=\{pillStyle\(false\)\}>\{fmtSimple\(e\.meta\?\.before\)\}<\/span>/)
})

test('verhuizen tussen agendas wordt gelogd met van en naar', () => {
  assert.match(store, /logItemActivity\(itemId, 'verplaatste naar een andere agenda'/)
  assert.match(store, /before: boardLabel\(sourceBoard\),\n\s+after: boardLabel\(targetBoard\),/)
})

test('de prullenbak levert de avatar van wie verwijderde', () => {
  assert.match(store, /deletedByMemberId: string \| null/)
  assert.match(store, /deletedByMemberId: r\.deleted_by \? \(memberByUid\.get\(r\.deleted_by\) \?\? null\) : null/)
})
