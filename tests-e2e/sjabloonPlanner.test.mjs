// 'Klus uitzetten' vanuit een sjabloon, zonder model.
//
// Zonder sleutel op de server is dit de hele planner: stappen kiezen,
// aanpassen, een datum geven, en de werkdagen worden teruggeteld. Er
// gaat niets de deur uit en het kost niets.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL, boardFixture } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function openPlanner({ aiAan = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  // De AI-kant blijft hier buiten beeld; alleen het antwoord 'staat de
  // sleutel er?' wordt nagebootst.
  await page.route('**/api/ai/plan', route => route.fulfill({ json: { available: aiAan } }))
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(boardFixture()))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Klus uitzetten/ }).first().click()
  await page.waitForTimeout(400)
  return page
}

test('zonder sleutel is het sjabloon er gewoon, zonder keuzetabs', { skip: skip ?? false }, async () => {
  const page = await openPlanner()
  assert.equal(await page.getByRole('tablist').count(), 0, 'niets te kiezen, dus geen tabs')
  assert.equal(await page.getByLabel('Stappen').count(), 1)
  await page.close()
})

test('met sleutel kun je kiezen, en het sjabloon staat voorop', { skip: skip ?? false }, async () => {
  const page = await openPlanner({ aiAan: true })
  assert.equal(await page.getByRole('tab', { name: 'Uit een sjabloon' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: 'Laten uitschrijven' }).click()
  await page.waitForTimeout(200)
  assert.equal(await page.getByLabel('Stappen').count(), 0, 'de andere manier staat nu in beeld')
  await page.close()
})

test('de stappen worden teruggeteld vanaf de datum en komen op het bord', { skip: skip ?? false }, async () => {
  const page = await openPlanner()

  await page.getByLabel('Naam van de klus').fill('NKO Explainer')
  await page.getByLabel('Af op').first().fill('20-11-2026')
  await page.getByLabel('Af op').first().blur()
  await page.getByLabel('Stappen').fill('Script · 2d\nAnimatie · 3d')
  await page.getByRole('button', { name: 'Zet de stappen uit' }).click()
  await page.waitForSelector('[data-ai-voorstel]')

  const voorstel = await page.locator('[data-ai-voorstel]').innerText()
  assert.match(voorstel, /NKO Explainer/)
  // Vrijdag 20 november is de laatste dag; animatie beslaat wo-vr,
  // script de twee werkdagen daarvoor.
  assert.match(voorstel, /16-11-2026/)
  assert.match(voorstel, /20-11-2026/)
  assert.match(voorstel, /40u/, 'vijf werkdagen van acht uur')

  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await page.waitForTimeout(900)

  const opHetBord = await page.evaluate(() => {
    const item = JSON.parse(localStorage.getItem('yoko-board-yoko'))[0].items
      .find(i => i.name === 'NKO Explainer')
    return item && {
      start: item.startDate, eind: item.endDate,
      subs: (item.subitems ?? []).map(s => [s.name, s.startDate, s.endDate, s.estHours]),
    }
  })
  assert.ok(opHetBord, 'het item staat op het bord')
  assert.equal(opHetBord.start, '2026-11-16')
  assert.equal(opHetBord.eind, '2026-11-20')
  assert.deepEqual(opHetBord.subs, [
    ['Script', '2026-11-16', '2026-11-17', 16],
    ['Animatie', '2026-11-18', '2026-11-20', 24],
  ])
  await page.close()
})

test('een vergeten datum levert uitleg op, geen halve planning', { skip: skip ?? false }, async () => {
  const page = await openPlanner()
  await page.getByLabel('Naam van de klus').fill('Klus zonder datum')
  await page.getByRole('button', { name: 'Zet de stappen uit' }).click()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('[data-ai-voorstel]').count(), 0)
  assert.match(await page.getByRole('alert').first().innerText(), /datum/i)
  await page.close()
})
