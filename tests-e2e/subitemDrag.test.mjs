// Subitems verslepen liet ze 'verdwijnen'.
//
// Ze werden niet verwijderd: ze sprongen uit hun ouder en kwamen als los
// item onderaan het bord terecht, vaak buiten beeld. De drop-handler op
// een itemrij begon met `if (!nestZone) return` — alleen de middelste 50%
// van een rij telde. Liet je een subitem er net boven of onder los, dan
// viel de drop door naar de groep eronder, en die maakt van een subitem
// een top-level item. Ook terugleggen op de eigen ouder viel daar
// doorheen, want dat pad stopte het event niet.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

/** Een subitem met ook velden die bij uitnesten verloren gingen. */
const subitem = (id, naam) => ({
  id, name: naam, ownerIds: ['menno'], status: 'Working on it',
  startDate: iso(1), endDate: iso(2), estHours: 2,
  deadline: iso(5), echtGewerkt: 1.5, eigenKolom: 'blijft staan',
})

const BORD = [{
  id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Ouder A', ownerIds: ['menno'], status: 'Working on it', estHours: 8,
      startDate: iso(0), endDate: iso(6), subitems: [subitem('s1', 'Sub een'), subitem('s2', 'Sub twee')] },
    { id: 'p2', name: 'Ouder B', ownerIds: ['menno'], status: 'Working on it', estHours: 8,
      startDate: iso(0), endDate: iso(6), subitems: [] },
  ],
}]

async function openBord() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  // Ouder A uitklappen zodat de subitems in de DOM staan.
  await page.locator('[data-item-id="p1"] button').first().click().catch(() => {})
  await page.waitForTimeout(600)
  return page
}

/** Wat staat er op het bord, zoals het is opgeslagen. */
const indeling = page => page.evaluate(() =>
  JSON.parse(localStorage.getItem('yoko-board-yoko'))
    .flatMap(groep => groep.items.map(i => `${i.name}[${(i.subitems ?? []).map(s => s.name).join(',') || '-'}]`))
    .join('  '))

/** Een HTML5-drag nabootsen: dragstart op de greep, drop op het doel.
 *  `positie` 'rand' mikt net binnen de bovenrand — precies waar het
 *  voorheen misging. */
const sleepNaar = (page, doelSelector, positie = 'midden') => page.evaluate(({ doelSelector, positie }) => {
  const greep = document.querySelector('.subitem-grip')
  const doel = document.querySelector(doelSelector)
  if (!greep || !doel) return 'niet gevonden'
  const dt = new DataTransfer()
  greep.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  const r = doel.getBoundingClientRect()
  const opts = {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: r.left + r.width / 2,
    clientY: positie === 'rand' ? r.top + 3 : r.top + r.height / 2,
  }
  doel.dispatchEvent(new DragEvent('dragover', opts))
  doel.dispatchEvent(new DragEvent('drop', opts))
  greep.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  return 'ok'
}, { doelSelector, positie })

test('een subitem terugleggen op de eigen ouder verandert niets', { skip: skip ?? false }, async () => {
  const page = await openBord()
  const voor = await indeling(page)
  assert.equal(await sleepNaar(page, '[data-item-id="p1"]', 'rand'), 'ok')
  await page.waitForTimeout(700)
  assert.equal(await indeling(page), voor, 'het subitem hoort gewoon te blijven staan')
  await page.close()
})

test('op de rand van een andere rij loslaten verhuist het subitem daarheen', { skip: skip ?? false }, async () => {
  const page = await openBord()
  assert.equal(await sleepNaar(page, '[data-item-id="p2"]', 'rand'), 'ok')
  await page.waitForTimeout(700)
  assert.equal(await indeling(page), 'Ouder A[Sub twee]  Ouder B[Sub een]')
  await page.close()
})

test('verhuizen behoudt alle velden, ook eigen kolommen', { skip: skip ?? false }, async () => {
  const page = await openBord()
  await sleepNaar(page, '[data-item-id="p2"]', 'midden')
  await page.waitForTimeout(700)
  const bewaard = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('yoko-board-yoko'))
      .flatMap(g => g.items).flatMap(i => i.subitems ?? []).find(x => x.id === 's1')
    return s ? { deadline: s.deadline, echtGewerkt: s.echtGewerkt, eigenKolom: s.eigenKolom } : null
  })
  await page.close()

  assert.notEqual(bewaard, null, 'het subitem bestaat nog')
  assert.equal(bewaard.echtGewerkt, 1.5)
  assert.equal(bewaard.eigenKolom, 'blijft staan')
  assert.ok(bewaard.deadline, 'de deadline is niet weggegooid')
})

test('loslaten op de lege ruimte van een groep maakt er bewust een los item van', { skip: skip ?? false }, async () => {
  // Dit is de bedoelde manier om iets uit te nesten; die moet blijven werken.
  const page = await openBord()
  const resultaat = await page.evaluate(() => {
    const greep = document.querySelector('.subitem-grip')
    // De drop-container is de binnenste div van de groep.
    const groep = document.querySelector('[data-group-id] > div')
    if (!greep || !groep) return 'niet gevonden'
    const dt = new DataTransfer()
    greep.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const r = groep.getBoundingClientRect()
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.bottom - 5 }
    groep.dispatchEvent(new DragEvent('dragover', opts))
    groep.dispatchEvent(new DragEvent('drop', opts))
    return 'ok'
  })
  assert.equal(resultaat, 'ok')
  await page.waitForTimeout(700)
  assert.match(await indeling(page), /Sub een\[-\]/, 'het subitem staat nu als los item op het bord')

  // En het is met één klik terug te draaien.
  const tekst = await page.evaluate(() => document.body.innerText)
  assert.match(tekst, /is nu een los item/, 'er komt een melding met uitleg')
  await page.getByText(/Maak ongedaan/).first().click()
  await page.waitForTimeout(700)
  assert.equal(await indeling(page), 'Ouder A[Sub een,Sub twee]  Ouder B[-]', 'ongedaan zet alles terug')
  await page.close()
})
