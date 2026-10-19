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
    .filter(t => /^(STUDIO YOKO|ONDERZOEK|EDITORS)$/i.test(t))
})

const EEN  = [{ id: 'a', name: 'Onderzoek', color: '#579bfc', position: 0, memberIds: ['menno'] }]
const TWEE = [
  { id: 'a', name: 'Onderzoek', color: '#579bfc', position: 0, memberIds: ['menno'] },
  { id: 'b', name: 'Editors',   color: '#e2445c', position: 1, memberIds: ['vincent'] },
]

test('met één team zijn de pijlen uitgezet en leggen ze uit waarom', { skip: skip ?? false }, async () => {
  const page = await openPaneel(EEN)
  const omhoog = page.getByTitle(/omhoog|bovenaan|tweede team/i).first()
  const omlaag = page.getByTitle(/omlaag|onderaan|tweede team/i).first()

  assert.equal(await omhoog.isDisabled(), true, '↑ is uitgezet')
  assert.equal(await omlaag.isDisabled(), true, '↓ is uitgezet')
  assert.match(await omhoog.getAttribute('title'), /tweede team/i, 'en zegt wat je moet doen')
  await page.close()
})

test('met twee teams verschuift ↓ de volgorde en blijft dat bewaard', { skip: skip ?? false }, async () => {
  const page = await openPaneel(TWEE)
  assert.deepEqual(await koppen(page), ['Studio Yoko', 'Onderzoek', 'Editors'])

  const omlaag = page.getByTitle('Team omlaag').first()
  assert.equal(await omlaag.isDisabled(), false, 'het bovenste team kan omlaag')
  await omlaag.click()
  await page.waitForTimeout(700)

  assert.deepEqual(await koppen(page), ['Studio Yoko', 'Editors', 'Onderzoek'], 'de volgorde is om')
  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-team-groups')).map(g => `${g.name}@${g.position}`).sort())
  assert.deepEqual(bewaard, ['Editors@0', 'Onderzoek@1'], 'en staat zo opgeslagen')
  await page.close()
})

test('het paneel zet de teams onder Studio Yoko, net als het raster', { skip: skip ?? false }, async () => {
  const page = await openPaneel(TWEE)
  const volgorde = await koppen(page)
  assert.equal(volgorde[0], 'Studio Yoko', 'Studio Yoko staat eerst, zoals in het raster erachter')
  await page.close()
})
