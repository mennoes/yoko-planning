// Het menu mag alleen het item markeren waar je daadwerkelijk op staat.
//
// Aanleiding: elke rij onder 'Pagina's' (Team, Kantoor, Accounts, Team
// beheren, Budget, Geschiedenis) stond permanent blauw opgelicht. De
// oorzaak was `boardDropTarget === targetBoardId`: voor alles wat geen
// agenda is, is targetBoardId null, en boardDropTarget is null zolang je
// niets sleept — dus null === null, en kreeg elke rij de 'laat hier
// los'-markering zonder dat er iets gesleept werd.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const DROP_BLAUW = /rgba?\(88,\s*150,\s*255/

async function menuRijen(pad) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(() => localStorage.setItem('yoko-profile',
    JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null })))
  await page.goto(BASE_URL + pad, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  // Secties openklappen. De kop is zelf een link, dus dit navigeert weg;
  // daarna gaan we terug naar de bedoelde pagina. De open/dicht-stand
  // blijft bewaard, dus de rijen staan er dan nog.
  for (const label of ["Agenda's", "Pagina's"]) {
    await page.locator(`aside >> text=${label}`).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
  await page.goto(BASE_URL + pad, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.mouse.move(1000, 900)   // muis uit het menu, anders meet je hover
  await page.waitForTimeout(400)

  const rijen = await page.evaluate(() => [...document.querySelectorAll('aside a')]
    .map(a => {
      const rij = a.parentElement
      return {
        tekst: (a.textContent ?? '').trim(),
        href: a.getAttribute('href'),
        linkBg: getComputedStyle(a).backgroundColor,
        rijBg: rij ? getComputedStyle(rij).backgroundColor : '',
        rijOutline: rij ? getComputedStyle(rij).outlineColor : '',
      }
    })
    .filter(r => r.href && r.tekst))
  await page.close()
  return rijen
}

test('geen enkel menu-item staat opgelicht als drop-doel zonder sleepactie', { skip: skip ?? false }, async () => {
  const rijen = await menuRijen('/planning')
  const opgelicht = rijen.filter(r => DROP_BLAUW.test(r.rijBg) || DROP_BLAUW.test(r.rijOutline))
  assert.deepEqual(opgelicht.map(r => r.tekst), [],
    'deze rijen tonen de sleep-markering terwijl er niets gesleept wordt')
})

test('alleen de pagina waar je op staat is gemarkeerd', { skip: skip ?? false }, async () => {
  const rijen = await menuRijen('/planning')
  const gemarkeerd = rijen.filter(r => r.linkBg !== 'rgba(0, 0, 0, 0)' && r.linkBg !== 'transparent')
  assert.ok(gemarkeerd.length <= 1, `verwacht hooguit één gemarkeerd item, kreeg: ${gemarkeerd.map(r => r.tekst).join(', ')}`)
  if (gemarkeerd.length === 1) assert.equal(gemarkeerd[0].href, '/planning')
})
