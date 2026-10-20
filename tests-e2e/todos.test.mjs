// De kop van de persoonlijke sectie op /todos.
//
// De klacht was dat de pagina verspringt als je een andere groep kiest.
// Alles wat bóven de kolommen staat moet daarom even hoog blijven,
// ongeacht hoeveel mensen er in de gekozen groep zitten — anders schuift
// het hele raster eronder weg terwijl je kijkt.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

// Twee groepen van verschillende grootte: dát is wat de kop van hoogte
// liet veranderen toen de personenrij nog mocht afbreken.
const GROEPEN = [
  { id: 'onderzoek', name: 'Onderzoek', color: '#9c7ee8', position: 0, memberIds: ['menno', 'vincent'] },
  { id: 'studio',    name: 'Studio',    color: '#579bfc', position: 1, memberIds: ['odette', 'kars', 'anne-fleur'] },
]

async function todosPagina({ breedte = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width: breedte, height: 900 }, colorScheme: 'light' })
  await page.addInitScript(groepen => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-team-groups', groepen)
  }, JSON.stringify(GROEPEN))
  await page.goto(BASE_URL + '/todos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  return page
}

test('van groep wisselen verandert niets aan de hoogte boven de kolommen', { skip: skip ?? false }, async () => {
  const page = await todosPagina()
  const knoppen = page.locator('[data-todo-team-group-filter] button')
  assert.ok(await knoppen.count() >= 2, 'er zijn meerdere groepen om tussen te wisselen')

  const meting = async () => page.evaluate(() => ({
    rij: Math.round(document.querySelector('[data-todo-people-filter]')?.getBoundingClientRect().height ?? -1),
    grid: Math.round(document.querySelector('[data-personal-todo-grid]')?.getBoundingClientRect().top ?? -1),
  }))

  const metingen = []
  for (const i of [0, 1, 0, 1]) {
    await knoppen.nth(i).click()
    await page.waitForTimeout(600)
    metingen.push(await meting())
  }
  await page.close()

  assert.ok(metingen[0].grid > 0, 'het raster staat er')
  for (const m of metingen) {
    assert.equal(m.rij, metingen[0].rij, `personenrij wisselt van hoogte: ${JSON.stringify(metingen)}`)
    assert.equal(m.grid, metingen[0].grid, `het raster verschuift: ${JSON.stringify(metingen)}`)
  }
})

test('de weekkiezer staat links, met de groepen ernaast op dezelfde regel', { skip: skip ?? false }, async () => {
  const page = await todosPagina({ breedte: 1500 })
  const posities = await page.evaluate(() => {
    const groepen = document.querySelector('[data-todo-team-group-filter]')
    const week = [...document.querySelectorAll('button')].find(b => /Deze week|Vorige week|Volgende week/.test(b.textContent ?? ''))
    if (!groepen || !week) return null
    const g = groepen.getBoundingClientRect(), w = week.getBoundingClientRect()
    return { weekLinks: Math.round(w.left), groepenLinks: Math.round(g.left), zelfdeRegel: Math.abs(w.top - g.top) < 24 }
  })
  await page.close()

  assert.notEqual(posities, null, 'weekkiezer en groepen staan allebei op de pagina')
  assert.ok(posities.weekLinks < posities.groepenLinks, 'de week staat links van de groepen')
  assert.ok(posities.zelfdeRegel, 'en ze staan op dezelfde regel')
})

test('alle personen zijn meteen zichtbaar, zonder iets open te klappen', { skip: skip ?? false }, async () => {
  const page = await todosPagina()
  const tekst = await page.evaluate(() => document.body.innerText)
  const zichtbaar = await page.locator('[data-todo-people-filter] label').count()
  await page.close()

  assert.doesNotMatch(tekst, /Personen tonen \/ verbergen/, 'het open/dicht-kopje is weg')
  assert.ok(zichtbaar >= 2, `de personen staan er meteen (${zichtbaar} gevonden)`)
})

/** De namen van de groepchips, op volgorde. */
const chipNamen = page => page.evaluate(() =>
  [...document.querySelectorAll('[data-todo-team-group-filter] button')]
    .map(b => (b.textContent ?? '').trim().replace(/\d+$/, ''))
    .filter(naam => naam && naam !== 'Alles'))

test('de chips staan in dezelfde volgorde als de secties op de planning', { skip: skip ?? false }, async () => {
  // Hier stond een eigen volgorde: eerst je eigen teams, dan de vaste
  // blokken op een vaste plek. Wat je op de planning instelde kwam dus
  // niet terug. Nu leest deze pagina dezelfde lijst.
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' })
  await page.addInitScript(groepen => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    // Studio Yoko staat hier bewust onder het eigen team: dat is een
    // volgorde die alleen uit de gedeelde opslag kan komen.
    localStorage.setItem('yoko-team-groups', groepen)
  }, JSON.stringify([
    { id: '__yoko__',   name: 'Studio Yoko', color: '#579bfc', position: 1, memberIds: [] },
    { id: 'onderzoek',  name: 'Onderzoek',   color: '#9c7ee8', position: 0, memberIds: ['menno', 'vincent'] },
  ]))
  await page.goto(BASE_URL + '/todos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  const namen = await chipNamen(page)
  await page.close()
  assert.equal(namen[0], 'Onderzoek', `het eigen team staat vooraan, kreeg ${namen.join(' / ')}`)
  assert.ok(namen.includes('Studio Yoko'), 'en Studio Yoko staat erachter')
  assert.ok(namen.indexOf('Onderzoek') < namen.indexOf('Studio Yoko'))
})

test('een chip verslepen verandert de volgorde, ook voor de planning', { skip: skip ?? false }, async () => {
  const page = await todosPagina({ breedte: 1200 })
  const voor = await chipNamen(page)
  assert.deepEqual(voor.slice(0, 2), ['Onderzoek', 'Studio'],
    `twee eigen teams om te wisselen, kreeg ${voor.join(' / ')}`)

  // De tweede chip op de plek van de eerste laten vallen.
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-todo-team-group-filter] button')]
    const bron = chips[1], doel = chips[0]
    const dt = new DataTransfer()
    bron.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    doel.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    doel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    bron.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  })
  await page.waitForTimeout(900)

  const na = await chipNamen(page)
  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-team-groups'))
      .sort((a, b) => a.position - b.position).map(g => g.name))
  await page.close()

  assert.deepEqual(na.slice(0, 2), ['Studio', 'Onderzoek'], `de chips zijn om, kreeg ${na.join(' / ')}`)
  // Dezelfde opslag die het venster op de planning leest.
  assert.ok(bewaard.indexOf('Studio') < bewaard.indexOf('Onderzoek'),
    `en dat staat in de gedeelde volgorde: ${bewaard.join(' / ')}`)
})
