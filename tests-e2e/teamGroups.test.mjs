// De teamvolgorde in 'Mensen & capaciteit' op de planning.
//
// Aanleiding: met één eigen team deden de ↑/↓-pijlen niets — er valt dan
// niets te verschuiven — maar ze zagen er wel uit als knoppen. En het
// venster zette de teams bóven Studio Yoko terwijl het raster erachter ze
// eronder zet, dus wat je instelde kwam niet overeen met wat je zag.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function openPaneel(groepen) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(g => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-team-groups', g)
  }, JSON.stringify(groepen))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Menu', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByText(/Mensen & capaciteit/).first().click()
  await page.waitForTimeout(800)
  return page
}

const koppen = page => page.evaluate(() => {
  const popup = [...document.querySelectorAll('div')].find(d => d.textContent?.startsWith('Mensen & capaciteit'))
  return [...popup.querySelectorAll('span, div')]
    .map(e => e.childElementCount === 0 ? (e.textContent ?? '').trim() : '')
    .filter(t => /^(STUDIO YOKO|ONDERZOEK|EDITORS|OVERIG)$/i.test(t))
})

const EEN  = [{ id: 'a', name: 'Onderzoek', color: '#579bfc', position: 0, memberIds: ['menno'] }]
const TWEE = [
  { id: 'a', name: 'Onderzoek', color: '#579bfc', position: 0, memberIds: ['menno'] },
  { id: 'b', name: 'Editors',   color: '#e2445c', position: 1, memberIds: ['vincent'] },
]

test('ook met één team valt er te schuiven, want Studio Yoko doet mee', { skip: skip ?? false }, async () => {
  // Eerder waren Studio Yoko, Freelancers en Inactief team vaste blokken
  // en kon alleen je eigen teams onderling wisselen — met één team deden
  // de pijlen dus niets. Nu staat alles in dezelfde lijst.
  const page = await openPaneel(EEN)
  assert.deepEqual(await koppen(page), ['Studio Yoko', 'Onderzoek', 'Overig'])

  const omhoog = page.getByTitle('Omhoog').first()
  assert.equal(await omhoog.isDisabled(), false, 'het team kan omhoog, langs Studio Yoko')
  await omhoog.click()
  await page.waitForTimeout(700)

  assert.deepEqual(await koppen(page), ['Onderzoek', 'Studio Yoko', 'Overig'], 'de volgorde is om')
  await page.close()
})

test('de nieuwe volgorde blijft bewaard, inclusief de vaste blokken', { skip: skip ?? false }, async () => {
  const page = await openPaneel(TWEE)
  assert.deepEqual(await koppen(page), ['Studio Yoko', 'Onderzoek', 'Editors', 'Overig'])

  // Het eerste eigen team omlaag.
  await page.getByTitle('Omlaag').nth(1).click()
  await page.waitForTimeout(700)
  assert.deepEqual(await koppen(page), ['Studio Yoko', 'Editors', 'Onderzoek', 'Overig'], 'de volgorde is om')

  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-team-groups'))
      .sort((a, b) => a.position - b.position).map(g => g.name))
  await page.close()
  // De vaste blokken staan nu óók in de opslag, met hun eigen positie.
  assert.deepEqual(bewaard, ['Studio Yoko', 'Editors', 'Onderzoek', 'Freelancers', 'Inactief team', 'Overig'])
})

test('de bovenste sectie kan niet verder omhoog', { skip: skip ?? false }, async () => {
  const page = await openPaneel(TWEE)
  const omhoog = page.getByTitle(/Omhoog|bovenaan/).first()
  assert.equal(await omhoog.isDisabled(), true)
  assert.match(await omhoog.getAttribute('title'), /bovenaan/i)
  await page.close()
})

test('Overig staat in dezelfde lijst en is te verplaatsen', { skip: skip ?? false }, async () => {
  // Overig stond buiten de lijst, onderaan vastgepind: geen pijltjes, dus
  // je kon 'm nergens anders neerzetten.
  const page = await openPaneel(EEN)
  const voor = await koppen(page)
  assert.ok(voor.includes('Overig'), `Overig doet mee in de lijst, kreeg ${voor.join(' / ')}`)
  assert.equal(voor[voor.length - 1], 'Overig', 'en staat standaard onderaan')

  // De ↑ van Overig: de laatste in het venster.
  const omhoog = page.getByTitle('Omhoog').last()
  assert.equal(await omhoog.isDisabled(), false, 'Overig kan omhoog')
  await omhoog.click()
  await page.waitForTimeout(700)

  // Op de koppen alleen is dit niet te zien: Freelancers en Inactief team
  // staan ertussen en die filtert `koppen` eruit. De opgeslagen volgorde
  // is het echte antwoord.
  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-team-groups'))
      .sort((a, b) => a.position - b.position).map(g => g.name))
  await page.close()
  assert.deepEqual(bewaard,
    ['Studio Yoko', 'Onderzoek', 'Freelancers', 'Overig', 'Inactief team'],
    'Overig is één plek opgeschoven en dat is opgeslagen')
})
