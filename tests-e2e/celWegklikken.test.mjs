// Een cel aanklikken en weer wegklikken is geen wijziging.
//
// De klacht: klik je in de agenda op Est Time van een item en daarna
// ergens anders, dan was de waarde ineens weg. Bij een item met
// subitems staat er 0 op het hoofditem zelf — de uren zitten in de
// subitems — dus begon het invoerveld leeg, en bij het wegklikken werd
// die lege waarde als 0 weggeschreven. Daarmee verdween niet alleen het
// getal maar ook de urenverdeling over de eigenaren.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

async function openBord(bord) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  return page
}

/** Wat staat er opgeslagen voor het hoofditem? */
const opgeslagen = page => page.evaluate(() => {
  const i = JSON.parse(localStorage.getItem('yoko-board-yoko')).flatMap(g => g.items).find(x => x.id === 'p1')
  return { estHours: i.estHours ?? null, ownerHours: i.ownerHours ?? null }
})

/** De cel in de hoofdrij die precies deze tekst toont. */
const estCel = (page, tekst) =>
  page.locator('[data-item-id="p1"] div').filter({ hasText: new RegExp(`^${tekst}$`) }).last()

/** Klik in die cel en daarna ergens anders. */
async function tikEnWeg(page, tekst) {
  await estCel(page, tekst).click()
  await page.waitForTimeout(400)
  await page.mouse.click(8, 8)
  await page.waitForTimeout(800)
}

test('Est Time aanklikken en wegklikken laat de uren staan', { skip: skip ?? false }, async () => {
  const page = await openBord([{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Losse klus', ownerIds: ['menno'], status: 'Working on it',
      estHours: 24, startDate: iso(0), endDate: iso(5), subitems: [] },
  ] }])
  const voor = await opgeslagen(page)
  await tikEnWeg(page, '24')
  const na = await opgeslagen(page)
  await page.close()
  assert.equal(voor.estHours, 24)
  assert.equal(na.estHours, 24, 'de 24 staat er nog')
})

test('bij een item met subitems blijven de uren én de verdeling staan', { skip: skip ?? false }, async () => {
  // Dit is het geval waarin het misging: het hoofditem heeft zelf geen
  // uren, dus het invoerveld begint leeg.
  const page = await openBord([{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Klus met subitems', ownerIds: ['menno', 'vincent'], status: 'Working on it',
      estHours: 0, ownerHours: { menno: 20, vincent: 10 },
      startDate: iso(0), endDate: iso(9), subitems: [
        { id: 's1', name: 'Deel een', ownerIds: ['menno'], status: 'Working on it', estHours: 20, startDate: iso(0), endDate: iso(4) },
        { id: 's2', name: 'Deel twee', ownerIds: ['vincent'], status: 'Working on it', estHours: 10, startDate: iso(5), endDate: iso(9) },
      ] },
  ] }])

  const zichtbaarVoor = await page.locator('[data-item-id="p1"]').innerText()
  assert.match(zichtbaarVoor, /30/, 'de rij toont de som van de subitems')

  const voor = await opgeslagen(page)
  await tikEnWeg(page, '30')
  const na = await opgeslagen(page)
  const zichtbaarNa = await page.locator('[data-item-id="p1"]').innerText()
  await page.close()

  assert.match(zichtbaarNa, /30/, `de som staat er nog: ${zichtbaarNa.replace(/\n/g, ' | ')}`)
  assert.deepEqual(na.ownerHours, voor.ownerHours, 'en de verdeling over de eigenaren is niet gewist')
  assert.equal(na.estHours, voor.estHours, 'de eigen uren van het hoofditem zijn niet op 0 gezet')
})

test('echt iets anders intikken wordt nog steeds opgeslagen', { skip: skip ?? false }, async () => {
  const page = await openBord([{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Losse klus', ownerIds: ['menno'], status: 'Working on it',
      estHours: 24, startDate: iso(0), endDate: iso(5), subitems: [] },
  ] }])
  await estCel(page, '24').click()
  await page.waitForTimeout(400)
  await page.locator('[data-item-id="p1"] input[type="number"]').first().fill('40')
  await page.mouse.click(8, 8)
  await page.waitForTimeout(900)

  const na = await opgeslagen(page)
  await page.close()
  assert.equal(na.estHours, 40, 'een nieuwe waarde landt gewoon')
})
