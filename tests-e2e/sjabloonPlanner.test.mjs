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
  await page.getByRole('button', { name: /Item aanmaken/ }).first().click()
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

  await page.getByRole('button', { name: 'Aanmaken', exact: true }).click()
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

test('het vonkje bij "+ Voeg item toe" opent hetzelfde venster', { skip: skip ?? false }, async () => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.route('**/api/ai/plan', route => route.fulfill({ json: { available: false } }))
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(boardFixture()))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(600)

  const vonkje = page.getByRole('button', { name: 'Item met subitems aanmaken' })
  assert.equal(await vonkje.count(), 1, 'de knop staat er')
  // Pas zichtbaar als je er met de muis bij bent; daarvoor hoort hij
  // niet te staan schreeuwen.
  assert.equal(await vonkje.evaluate(el => getComputedStyle(el).opacity), '0')
  await page.getByText('+ Voeg item toe').hover()
  await page.waitForTimeout(300)
  assert.equal(await vonkje.evaluate(el => getComputedStyle(el).opacity), '1')

  await vonkje.click()
  await page.waitForTimeout(400)
  assert.equal(await page.getByRole('dialog', { name: 'Item aanmaken' }).count(), 1)
  await page.close()
})

test('een balkje verslepen verzet de stap en de uren lopen mee', { skip: skip ?? false }, async () => {
  const page = await openPlanner()
  await page.getByLabel('Naam van de klus').fill('Explainer')
  await page.getByLabel('Af op').first().fill('11-12-2026')
  await page.getByLabel('Af op').first().blur()
  await page.getByLabel('Stappen').fill('Script · 2d\nStoryboard · 1d\nAnimatie · 5d')
  await page.getByRole('button', { name: 'Zet de stappen uit' }).click()
  await page.waitForSelector('[data-voorstel-tijdlijn]')

  const regels = () => page.locator('[data-ai-voorstel] li').allInnerTexts()
  const voor = await regels()
  assert.match(voor[1], /Storyboard/)

  // De balk van Storyboard twee dagen naar achteren.
  const balk = page.locator('[data-stap-balk="1"]')
  const box = await balk.boundingBox()
  const baan = await page.locator('[data-voorstel-tijdlijn] [data-stap-balk="0"]').evaluate(
    el => el.parentElement.getBoundingClientRect().width)
  const dagBreedte = baan / 15 // 11 dagen periode plus twee dagen lucht aan weerskanten
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dagBreedte * 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  const na = await regels()
  assert.notEqual(na[1], voor[1], `Storyboard is verzet (was "${voor[1]}", nu "${na[1]}")`)
  assert.doesNotMatch(na[1], /05-12-2026|06-12-2026/, 'en niet het weekend in')

  // Aan de rechterrand trekken maakt 'm langer, inclusief de uren.
  const animatie = page.locator('[data-stap-balk="2"]')
  const animatieBox = await animatie.boundingBox()
  await page.mouse.move(animatieBox.x + animatieBox.width - 3, animatieBox.y + animatieBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(animatieBox.x + animatieBox.width - 3 - dagBreedte * 2, animatieBox.y + animatieBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const korter = (await regels())[2]
  assert.match(korter, /24u|32u/, `minder dagen is minder uren, kreeg "${korter}"`)
  await page.close()
})

test('een geplakte mail vult de naam, de datum en de stappen', { skip: skip ?? false }, async () => {
  const page = await openPlanner()
  await page.getByRole('button', { name: 'Uit een mail halen' }).click()
  await page.getByLabel('Plak de mail').fill([
    'Onderwerp: Explainer zonnepanelen',
    '',
    'Hoi Menno,',
    '',
    'We willen de video uiterlijk 11 december 2026 live zetten.',
    '',
    '- Script schrijven (2 dagen)',
    '- Storyboard',
    '- Animatie maken (5 werkdagen)',
    '',
    'Met vriendelijke groet,',
    'Joris',
  ].join('\n'))
  await page.getByRole('button', { name: 'Haal de stappen eruit' }).click()
  await page.waitForTimeout(400)

  assert.equal(await page.getByLabel('Naam van de klus').inputValue(), 'Explainer zonnepanelen')
  assert.equal(await page.getByLabel('Af op').first().inputValue(), '11-12-2026')
  const stappen = await page.getByLabel('Stappen').inputValue()
  assert.equal(stappen, 'Script schrijven · 2d\nStoryboard · 1d\nAnimatie maken · 5d')
  assert.match(await page.getByRole('status').innerText(), /Uit de mail gehaald/)
  await page.close()
})
