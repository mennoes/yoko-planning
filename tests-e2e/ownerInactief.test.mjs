// Een gestopte collega als owner kunnen kiezen.
//
// De klacht: Manuel werkte aan een klus, is inmiddels inactief, en was
// nergens meer te vinden om als owner te zetten. De owner-kiezer liet
// inactieve mensen helemaal weg — ook uit de zoekregel, en ook als ze al
// toegewezen wáren.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL, boardFixture } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const TEAM = [
  { id: 'menno',  name: 'Menno',  color: '#579bfc', kind: 'yoko', weeklyCapacity: 40 },
  { id: 'odette', name: 'Odette', color: '#e2445c', kind: 'yoko', weeklyCapacity: 40 },
  { id: 'manuel', name: 'Manuel', color: '#00c875', kind: 'freelance', weeklyCapacity: 0, inactive: true },
]

async function openAgenda(board = boardFixture()) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', payload.board)
    localStorage.setItem('yoko-team-members', payload.team)
  }, { board: JSON.stringify(board), team: JSON.stringify(TEAM) })
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(800)
  return page
}

test('een inactieve collega is te vinden en toe te wijzen', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.locator('[data-item-id="i1"]').getByLabel('Owners wijzigen').first().click()
  await page.waitForTimeout(400)

  // Niet tussen de snelle gezichten — daar hoort wie nu meedraait.
  const snel = await page.locator('[role="dialog"], body').first().innerText()
  assert.doesNotMatch(snel.split('Zoek iemand')[0], /Manuel/, 'staat niet bij de zes snelle namen')

  await page.getByPlaceholder('Zoek iemand…').fill('manuel')
  await page.waitForTimeout(300)
  const treffer = page.getByRole('button', { name: /Manuel/ }).first()
  assert.equal(await treffer.count(), 1, 'Manuel is via de zoekregel te vinden')
  assert.match(await treffer.innerText(), /inactief/i, 'met erbij dat hij gestopt is')

  await treffer.click()
  await page.waitForTimeout(600)
  const opgeslagen = await page.evaluate(() => {
    const groups = JSON.parse(localStorage.getItem('yoko-board-yoko'))
    return groups[0].items.find(i => i.id === 'i1').ownerIds
  })
  assert.ok(opgeslagen.includes('manuel'), `Manuel staat als owner opgeslagen, kreeg ${opgeslagen.join(',')}`)
  await page.close()
})

test('een al toegewezen inactieve owner blijft op het item staan', { skip: skip ?? false }, async () => {
  const bord = boardFixture()
  bord[0].items[0].ownerIds = ['manuel']
  const page = await openAgenda(bord)

  const cel = page.locator('[data-item-id="i1"]').getByLabel('Owners wijzigen').first()
  // Eerder viel zo'n owner uit beeld: geen gezicht, alleen een streepje.
  assert.doesNotMatch((await cel.innerText()).trim(), /^—$/, 'de owner is niet verdwenen')
  // Een gezicht of, zonder foto, de initiaal — in elk geval iets van
  // Manuel en niet een lege cel.
  assert.equal(await cel.locator('img, span').count() > 0, true, 'er staat een owner in de cel')

  // En in de kiezer staat hij aangevinkt, met 'inactief' erbij.
  await cel.click()
  await page.waitForTimeout(400)
  const regel = page.getByRole('button', { name: /Manuel/ }).first()
  assert.match(await regel.innerText(), /inactief/i, 'herkenbaar als gestopt')
  assert.match(await regel.innerText(), /✓/, 'en aangevinkt')
  await page.close()
})
