// De Tijdlijn-weergave van één agenda.
//
// Dezelfde items als in de Lijst, maar als balken over de tijd. Het
// verschil met /planning is wat een rij betekent: daar een persoon
// ('wie heeft het te druk'), hier een item ('wat loopt wanneer').

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [
  { id: 'g1', name: 'Colleges', color: '#9c7ee8', items: [
    { id: 'i1', name: 'NL College S04 E33', ownerIds: ['menno'], status: 'Working on it', estHours: 16,
      startDate: iso(-3), endDate: iso(4), subitems: [] },
    { id: 'i3', name: 'Nog te plannen klus', ownerIds: [], status: '', estHours: 0,
      startDate: null, endDate: null, subitems: [] },
  ] },
  { id: 'g2', name: 'Shorts', color: '#e2445c', items: [
    { id: 'i4', name: 'FTI Shorts x14', ownerIds: ['odette'], status: 'Working on it', estHours: 40,
      startDate: iso(7), endDate: iso(35), subitems: [] },
    { id: 'i5', name: 'Allang klaar', ownerIds: ['odette'], status: 'Done', estHours: 8,
      startDate: iso(-90), endDate: iso(-85), subitems: [] },
  ] },
  // Een groep die 'Done' heet is een archief: alles erin is per definitie
  // afgerond, ook zonder dat elk item de status Done heeft.
  { id: 'g3', name: 'Done', color: '#00c875', items: [
    { id: 'i6', name: 'Archiefklus', ownerIds: ['menno'], status: '', estHours: 4,
      startDate: iso(-120), endDate: iso(-110), subitems: [] },
  ] },
]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  return page
}

test('de agenda heeft een schakelaar Lijst / Tijdlijn', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  assert.equal(await page.getByRole('button', { name: 'Lijst' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Tijdlijn' }).count(), 1)
  // Lijst is de startweergave; de Tijdlijn is iets wat je kiest.
  assert.equal(await page.getByRole('button', { name: 'Lijst' }).getAttribute('aria-pressed'), 'true')
  await page.close()
})

test('de tijdlijn toont een balk per item met de juiste periode', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const balken = await page.evaluate(() =>
    [...document.querySelectorAll('button[title*="·"]')].map(b => b.title))
  await page.close()

  assert.ok(balken.some(t => t.startsWith('NL College S04 E33 ·')), `verwacht een balk voor het college, kreeg: ${balken.join(' | ')}`)
  assert.ok(balken.some(t => t.startsWith('FTI Shorts x14 ·')), 'en één voor de shorts')
})

test('items zonder datum verdwijnen niet uit beeld', { skip: skip ?? false }, async () => {
  // Zonder deze lijst zou de Tijdlijn stilzwijgend minder tonen dan de
  // Lijst, en dat is precies hoe je items kwijtraakt.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const chip = page.getByRole('button', { name: 'Nog te plannen klus' })
  assert.equal(await chip.count(), 1, 'het item zonder datum staat er')
  const doos = await chip.first().boundingBox()
  await page.close()
  assert.ok(doos && doos.x > 0, `het staat ook echt in beeld (x=${doos?.x})`)
})

test('afgerond werk staat er standaard niet bij', { skip: skip ?? false }, async () => {
  // De klacht: de tijdlijn toonde letterlijk alles, ook werk van maanden
  // geleden waar je niets meer aan hebt. De lijst stopt dat al in een
  // ingeklapt 'Afgerond'-blok; de tijdlijn volgt nu dezelfde regel.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const namen = await page.evaluate(() =>
    [...document.querySelectorAll('button[title*="·"]')].map(b => b.title.split(' ·')[0]))
  await page.close()

  assert.ok(namen.includes('NL College S04 E33'), 'lopend werk staat er')
  assert.ok(namen.includes('FTI Shorts x14'), 'en werk dat eraan komt ook')
  assert.ok(!namen.includes('Allang klaar'), 'een afgerond item niet')
  assert.ok(!namen.includes('Archiefklus'), 'en een item uit een Done-groep ook niet')
})

test('je kunt afgerond werk erbij zetten, en ziet hoeveel het er zijn', { skip: skip ?? false }, async () => {
  // Stilletjes minder tonen is hoe je denkt dat items verdwenen zijn, dus
  // de knop noemt het aantal.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const knop = page.getByRole('button', { name: /Afgerond \(/ })
  assert.equal(await knop.count(), 1, 'er staat een knop met het aantal')
  assert.match(await knop.first().textContent(), /Afgerond \(2\)/)

  await knop.first().click()
  await page.waitForTimeout(900)
  const namen = await page.evaluate(() =>
    [...document.querySelectorAll('button[title*="·"]')].map(b => b.title.split(' ·')[0]))
  await page.close()

  assert.ok(namen.includes('Allang klaar'), 'nu staat het afgeronde werk er wel')
  assert.ok(namen.includes('Archiefklus'))
})

test('klikken op een balk opent de popup zonder van weergave te wisselen', { skip: skip ?? false }, async () => {
  // Eerst schakelde dit terug naar de Lijst en lichtte daar de rij op.
  // Dan ben je je plek in de tijd kwijt en moet je de popup alsnog zelf
  // openen.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  await page.getByRole('button', { name: /NL College S04 E33/ }).first().click()
  await page.waitForTimeout(1000)

  const actief = await page.evaluate(() =>
    document.querySelector('[role="group"][aria-label="Weergave"] button[aria-pressed="true"]')?.textContent)
  const popupOpen = await page.evaluate(() =>
    /Activiteit|Notities/i.test(document.body.innerText) && /NL College S04 E33/.test(document.body.innerText))
  await page.close()

  assert.equal(actief, 'Tijdlijn', 'je blijft in de tijdlijn staan')
  assert.ok(popupOpen, 'en de item-popup staat open')
})

test('de keuze wordt per agenda onthouden', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(600)
  assert.equal(await page.evaluate(() => localStorage.getItem('yoko-board-weergave-nederland')), 'tijdlijn')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const actief = await page.evaluate(() =>
    document.querySelector('[role="group"][aria-label="Weergave"] button[aria-pressed="true"]')?.textContent)
  // Een andere agenda houdt zijn eigen keuze.
  const anders = await page.evaluate(() => localStorage.getItem('yoko-board-weergave-yoko'))
  await page.close()

  assert.equal(actief, 'Tijdlijn', 'na een refresh sta je nog in de Tijdlijn')
  assert.equal(anders, null, 'en een andere agenda is daar niet door veranderd')
})
