// Flow-tests voor de agenda-pagina.
//
// Elke test hieronder legt een bug vast die deze week meerdere keren
// 'gefixt' is geweest en toch terugkwam. De oude broncode-tests dekten ze
// niet: die controleerden dát er een softDeleteItem-aanroep in het bestand
// stond, niet dát het item wegbleef.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, openPage, gotoBoard, itemNames } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

test('het kruisje vraagt eerst om bevestiging', { skip: skip ?? false }, async () => {
  const page = await openPage(browser)
  await gotoBoard(page)

  let gevraagd = null
  page.once('dialog', d => { gevraagd = d.message(); d.dismiss() })
  await page.locator('[data-item-id="i1"]').hover()
  await page.getByLabel('Eerste item verwijderen').click()
  await page.waitForTimeout(600)

  assert.ok(gevraagd, 'er komt een bevestiging')
  assert.match(gevraagd, /verwijderen\?/i)
  assert.deepEqual(await itemNames(page), ['i1', 'i2'], 'annuleren laat het item staan')
  await page.close()
})

test('een verwijdering die niet opgeslagen kan worden liegt niet', { skip: skip ?? false }, async () => {
  // Dit is de bug die deze week drie keer 'gefixt' was: PostgREST geeft
  // geen fout als een update nul rijen raakt, dus het item verdween uit
  // beeld en stond na een refresh weer terug. Nu moet een mislukte
  // verwijdering het item zichtbaar terugzetten én zeggen waarom.
  //
  // Zonder Supabase-config is élke verwijdering zo'n mislukking, dus dit
  // pad is hier precies te testen. Het gelukte pad heeft een database
  // nodig en valt buiten deze suite.
  const page = await openPage(browser)
  await gotoBoard(page)

  page.once('dialog', d => d.accept())
  await page.locator('[data-item-id="i1"]').hover()
  await page.getByLabel('Eerste item verwijderen').click()
  await page.waitForTimeout(1200)

  assert.deepEqual(await itemNames(page), ['i1', 'i2'], 'het item staat er nog')
  const tekst = await page.evaluate(() => document.body.innerText)
  assert.match(tekst, /niet.*opgeslagen/i, 'en de reden staat in beeld')
  await page.close()
})

test('een groep in- en uitklappen laat de rijen verdwijnen en terugkomen', { skip: skip ?? false }, async () => {
  const page = await openPage(browser)
  await gotoBoard(page)

  const toggle = page.locator('[data-group-id] button').first()
  await toggle.click()
  await page.waitForTimeout(400)
  assert.deepEqual(await itemNames(page), [], 'ingeklapt: geen rijen')

  await toggle.click()
  await page.waitForTimeout(400)
  assert.deepEqual(await itemNames(page), ['i1', 'i2'], 'uitgeklapt: rijen terug')
  await page.close()
})

test('rijen buiten beeld blijven bereikbaar en klikbaar', { skip: skip ?? false }, async () => {
  // content-visibility: auto slaat rijen buiten beeld over. Dat mag nooit
  // betekenen dat je er niet meer naartoe kunt scrollen of op kunt klikken.
  const iso = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }
  const veel = [{
    id: 'g1', name: 'Veel', color: '#579bfc',
    items: Array.from({ length: 120 }, (_, i) => ({
      id: `n${i}`, name: `Item ${i}`, ownerIds: ['menno'], status: 'Working on it',
      estHours: 1, startDate: iso(1), endDate: iso(3), subitems: [],
    })),
  }]
  const page = await openPage(browser, { board: veel })
  await gotoBoard(page)

  const laatste = page.locator('[data-item-id="n119"]')
  await laatste.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  assert.equal(await laatste.isVisible(), true, 'de laatste rij is zichtbaar na scrollen')

  const hoogte = await laatste.evaluate(el => Math.round(el.getBoundingClientRect().height))
  assert.ok(hoogte > 20, `de rij heeft een echte hoogte (${hoogte}px), niet alleen de schatting`)
  await page.close()
})

test('de naamkolom blijft op mobiel staan bij horizontaal scrollen', { skip: skip ?? false }, async () => {
  const page = await openPage(browser, { mobile: true })
  await gotoBoard(page)

  const verschuiving = await page.evaluate(async () => {
    const sticky = document.querySelector('[data-item-id] [style*="sticky"]')
    if (!sticky) return null
    const scroller = [...document.querySelectorAll('*')]
      .find(el => el.scrollWidth > el.clientWidth + 50 && el.clientWidth > 300)
    if (!scroller) return null
    const voor = sticky.getBoundingClientRect().left
    scroller.scrollLeft = 300
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return Math.abs(sticky.getBoundingClientRect().left - voor)
  })

  assert.notEqual(verschuiving, null, 'er is een sticky naamkolom en een horizontale scroller')
  assert.ok(verschuiving < 60, `de naamkolom schuift nauwelijks mee (${verschuiving}px bij 300px scroll)`)
  await page.close()
})
