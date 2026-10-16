import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const demo = readFileSync(new URL('../components/DemoHomePage.tsx', import.meta.url), 'utf8')

for (const [name, source] of [['home', home], ['demo', demo]]) {
  test(`${name}: de to do-kaart toont geen losse overhead-balk meer`, () => {
    assert.doesNotMatch(source, /u<\/strong> overhead/)
    assert.doesNotMatch(source, /\$\{overheadHours\}u overhead/)
    assert.doesNotMatch(source, /overheadHours\/cap/)
    // De uren verdwijnen niet: ze tellen bij maken, anders klopt het
    // totaal in de balk niet meer met het grote getal erboven.
    assert.match(source, /catOf\(i\) === 'maken' \|\| catOf\(i\) === 'overhead'/)
    assert.match(source, /const total = meetingHours \+ makenHours \+ vrijHours/)
  })
}

test('de categorie zelf blijft bestaan voor bestaande data en de planning', () => {
  const categories = readFileSync(new URL('../lib/workloadCategory.ts', import.meta.url), 'utf8')
  assert.match(categories, /overhead: 'Overige maken'/)
})
