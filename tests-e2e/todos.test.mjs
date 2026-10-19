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
