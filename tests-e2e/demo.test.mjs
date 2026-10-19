// /demo en de echte app delen steeds meer code. Dat is de bedoeling — de
// demo was een handmatige kopie die bij elke wijziging opnieuw uit de pas
// liep. Maar het mag nooit betekenen dat een demo-bezoeker echte data ziet
// of dat de demo in echte sleutels schrijft. Dat is wat hier bewaakt wordt.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function bezoek(pad, { profiel } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  if (profiel) {
    await page.addInitScript(p => localStorage.setItem('yoko-profile', p), JSON.stringify(profiel))
  }
  await page.goto(BASE_URL + pad, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const tekst = await page.evaluate(() => document.body.innerText)
  const sleutels = await page.evaluate(() => Object.keys(localStorage))
  await page.close()
  return { tekst, sleutels }
}

const MENNO = { memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }

test('de demo-budgetpagina toont verzonnen data en schrijft alleen naar demo-sleutels', { skip: skip ?? false }, async () => {
  const { tekst, sleutels } = await bezoek('/demo/budget')

  assert.match(tekst, /orks vóór zonsopgang/, 'de verzonnen omzetregel staat er')
  const budgetSleutels = sleutels.filter(k => /budget|revenue/.test(k))
  assert.ok(budgetSleutels.length > 0, 'er is iets opgeslagen')
  for (const k of budgetSleutels) {
    assert.match(k, /^yoko-demo-/, `${k} hoort een demo-sleutel te zijn`)
  }
})

test('de demo noemt nooit een echte teamnaam op de budgetpagina', { skip: skip ?? false }, async () => {
  const { tekst } = await bezoek('/demo/budget')
  assert.doesNotMatch(tekst, /Menno|Vincent/, 'echte namen horen niet in de demo')
  assert.match(tekst, /Bert|Pippi/, 'de verzonnen namen wel')
})

test('de echte budgetpagina raakt geen demo-data aan', { skip: skip ?? false }, async () => {
  const { tekst, sleutels } = await bezoek('/budget', { profiel: MENNO })
  assert.doesNotMatch(tekst, /orks vóór zonsopgang/, 'geen verzonnen regels in de echte app')
  assert.equal(sleutels.filter(k => /^yoko-demo-.*(budget|revenue)/.test(k)).length, 0,
    'en er wordt niets in demo-sleutels geschreven')
})
