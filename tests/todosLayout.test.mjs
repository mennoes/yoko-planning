import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/todos/page.tsx', import.meta.url), 'utf8')
const weekly = readFileSync(new URL('../components/MemberWeeklyTodos.tsx', import.meta.url), 'utf8')

test('de kop "To do’s" staat niet bij elke collega opnieuw', () => {
  // De pagina heet al To do's en de naam van de persoon staat er direct
  // boven; in de smalle kolomweergave is die kop pure herhaling.
  assert.match(weekly, /\{!compact && \(/)
  assert.match(weekly, /uit Agenda &amp; Planning/)
  assert.doesNotMatch(weekly, /compact \? <>Agenda \+ Planning<\/>/)
})

test('de algemene rij telt zijn eigen kolommen en blijft op één regel', () => {
  // Stond op het AANTAL PERSONEN: meer secties dan personen betekende een
  // tweede regel. Nu bepaalt het aantal secties de kolommen.
  assert.match(page, /const generalCols = Math\.max\(1, general\.length\)/)
  assert.match(page, /repeat\(\$\{generalCols\}, minmax\(\$\{COL_MIN\}px, 1fr\)\)/)
  assert.match(page, /const COL_MIN = 250/)
  // Past 't niet, dan scroll je horizontaal in plaats van te wrappen.
  assert.match(page, /overflowX: 'auto' as const/)
})

test('de losse +-kolom is weg; de knop bovenaan blijft', () => {
  assert.doesNotMatch(page, /Persistente '\+ sectie'-knop/)
  // Nog twee keer: de knop in de desktopkop en het item in het mobiele
  // ⋯-menu. De dashed kolom aan het eind van de rij is weg.
  assert.equal((page.match(/\+ Nieuwe sectie/g) ?? []).length, 2)
})

test('kaarten naast elkaar krijgen een compacte kop', () => {
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /padding: compact \? '8px 12px 7px' : '13px 16px 11px'/)
  assert.match(page, /fontSize: compact \? 12\.5 : 18/)
  assert.match(page, /<TodoCard section=\{additions\} isMember=\{true\} compact/)
  assert.match(page, /<TodoCard key=\{s\.id\} section=\{s\} isMember=\{false\} onUpdate=\{updateSection\} compact/)
})

test('mobiel: geen paginatitel, knoppen in een menu', () => {
  // De app-navigatie zegt al waar je bent; titel + losse knoppen kostten
  // een kwart scherm. Alleen de weeknavigatie blijft in beeld.
  assert.match(page, /\{isMobile \? \(/)
  assert.match(page, /aria-label="Meer opties"/)
  assert.match(page, /\{editOrder \? 'Klaar met sorteren' : 'Volgorde aanpassen'\}/)
  assert.match(page, /data-todos-page-menu/)
  // Sluiten via een document-listener: een overlay-div viel onder de
  // kaarten door een stacking context verderop in de pagina.
  assert.match(page, /document\.addEventListener\('pointerdown', close, true\)/)
  assert.match(page, /window\.addEventListener\('scroll', close, true\)/)
})

test('mobiel: dezelfde herhaling weg als naast elkaar', () => {
  assert.match(page, /<MemberWeeklyTodos compact memberId=\{section\.id\}/)
  assert.match(page, /<TodoCard section=\{additions\} isMember=\{true\} compact/)
  assert.doesNotMatch(page, /<h2 style=\{\{ fontSize: 16 \}\}>Persoonlijk<\/h2>/)
  // Het kopje 'Groepen' boven de groepsknoppen is nu overal weg, niet
  // alleen op mobiel: de knoppen zeggen zelf al wat ze zijn, en ze staan
  // inmiddels op dezelfde regel als de weekkiezer.
  assert.doesNotMatch(page, />Groepen<\/span>/)
})

test('een kaart met vaste titel heeft geen losse emoji', () => {
  assert.match(page, /\) : displayTitle \? \(/)
})

test('één week-bucket van deze week heeft geen label nodig', () => {
  assert.match(page, /const hideLabel = weekBuckets\.length === 1 && weeksFromThis\(bucket\.iso\) <= 0/)
  assert.match(page, /display: hideLabel \? 'none' : 'flex'/)
})

test('de weekkiezer staat bij de persoonlijke sectie, niet in de paginakop', () => {
  // Alleen de persoonlijke kolommen veranderen met de week; bovenin stond
  // de keuzeknop los van waar je 'm voor gebruikt, met de algemene
  // secties ertussen.
  assert.match(page, /const weekNav = \(/)
  const header = page.slice(page.indexOf('<h1 style='), page.indexOf('{syncError &&'))
  assert.doesNotMatch(header, /Naar deze week/)
  // De sectiekop toont 'm. Let op personalBase, niet personal: kies je een
  // groep waar niemand in zit, dan is personal leeg — en dan mag de balk
  // met de weekkiezer én de groepsknoppen niet verdwijnen, want anders kun
  // je geen andere groep meer kiezen.
  assert.match(page, /\{personalBase\.length > 0 && \(\n[\s\S]{0,400}?\{weekNav\}/)
})
