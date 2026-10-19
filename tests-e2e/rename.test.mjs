// Een agenda hernoemen. Dit is de bug die vier keer 'gefixt' was en vier
// keer terugkwam ("veranderd meteen terug"). De broncode-tests konden dat
// niet zien: die controleerden dat renameBoard werd aangeroepen, niet dat
// de naam bleef staan.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, openPage, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()

// Zonder Supabase-config weigert de app élke hernoeming met "Geen
// databaseverbinding." — terecht, maar dan valt het gelukte pad niet te
// testen. Die test slaat zichzelf dan over met uitleg in plaats van rood
// te staan om iets dat niet kapot is.
const geenDb = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? false
  : 'geen NEXT_PUBLIC_SUPABASE_URL — het gelukte hernoem-pad heeft een database nodig'

let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function openSidebarBoards(page) {
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByText("Agenda's", { exact: true }).click()
  await page.waitForTimeout(500)
}

test('een agendanaam wijzigen blijft staan na een refresh', { skip: skip ?? geenDb }, async () => {
  const nieuw = `Hernoemd ${Date.now().toString().slice(-6)}`
  const page = await openPage(browser)
  await openSidebarBoards(page)

  await page.getByTitle('Naam wijzigen').first().click()
  await page.waitForTimeout(300)

  const veld = page.locator('aside input, nav input').first()
  await veld.fill(nieuw)
  await veld.press('Enter')
  await page.waitForTimeout(1200)

  const zichtbaarNa = await page.evaluate(() => document.body.innerText)
  assert.match(zichtbaarNa, new RegExp(nieuw), 'de nieuwe naam staat meteen in het menu')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.getByText("Agenda's", { exact: true }).click()
  await page.waitForTimeout(600)

  const naRefresh = await page.evaluate(() => document.body.innerText)
  assert.match(naRefresh, new RegExp(nieuw), 'en staat er na een refresh nog steeds')
  await page.close()
})

test('een mislukte hernoeming zegt waarom in plaats van stil terug te springen', { skip: skip ?? false }, async () => {
  // De kern van de vier mislukte fixes: hernoemen faalde stil, dus het
  // veld sprong terug zonder uitleg en er viel niets te debuggen. Lukt het
  // wel, dan staat de naam er; lukt het niet, dan hoort er een reden bij.
  // Beide uitkomsten zijn goed — stil terugspringen niet.
  const page = await openPage(browser)
  await openSidebarBoards(page)

  await page.getByTitle('Naam wijzigen').first().click()
  await page.waitForTimeout(300)
  const veld = page.locator('aside input, nav input').first()
  await veld.fill('Naam na mislukking')
  await veld.press('Enter')
  await page.waitForTimeout(1200)

  const tekst = await page.evaluate(() => document.body.innerText)
  const gelukt   = /Naam na mislukking/.test(tekst)
  const uitgelegd = /geweigerd|niet opgeslagen|mislukt/i.test(tekst)
  assert.ok(gelukt || uitgelegd, 'of de naam staat er, of er staat een reden bij')
  await page.close()
})
