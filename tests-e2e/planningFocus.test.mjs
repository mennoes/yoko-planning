// Uitklappen dempt de andere rijen zodat de uitgeklapte persoon opvalt.
//
// Voor Unassigned klopt dat niet: dat is geen persoon maar een bak met
// werk dat nog verdeeld moet worden. Klap je die open, dan wil je de
// mensen eromheen juist goed kunnen lezen om er iets heen te slepen —
// en stond alles grijs.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
  { id: 'i1', name: 'Nog te verdelen', ownerIds: ['unassigned'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
  { id: 'i2', name: 'Klus van Vincent', ownerIds: ['vincent'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
  { id: 'i3', name: 'Klus van Odette', ownerIds: ['odette'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
] }]

async function openPlanning() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
    sessionStorage.removeItem('planning-expanded-members')
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  return page
}

/** Hoe doorzichtig staat de rij van deze persoon erbij? */
const doorzichtigheid = (page, id) => page.evaluate(memberId => {
  const rij = document.querySelector(`[data-member-id="${memberId}"]`)
  const schil = rij?.parentElement
  const lees = el => el ? Number(getComputedStyle(el).opacity) : null
  // De demping zit op de rij zelf (dagweergave) of op de schil eromheen
  // (overzicht); de laagste van de twee is wat je ziet.
  return Math.min(lees(rij) ?? 1, lees(schil) ?? 1)
}, id)

test('Unassigned openklappen dempt de andere rijen niet', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  assert.equal(await doorzichtigheid(page, 'vincent'), 1, 'niets gedempt om mee te beginnen')

  await page.getByText('Unassigned', { exact: true }).last().click()
  await page.waitForTimeout(800)

  const vincent = await doorzichtigheid(page, 'vincent')
  const odette  = await doorzichtigheid(page, 'odette')
  await page.close()
  assert.equal(vincent, 1, `Vincent blijft leesbaar (${vincent})`)
  assert.equal(odette, 1, `en Odette ook (${odette})`)
})

test('een persoon openklappen dempt de rest nog steeds wel', { skip: skip ?? false }, async () => {
  // De focus-mode zelf blijft; alleen Unassigned doet er niet aan mee.
  const page = await openPlanning()
  await page.getByText('Vincent', { exact: true }).last().click()
  await page.waitForTimeout(800)

  const vincent = await doorzichtigheid(page, 'vincent')
  const odette  = await doorzichtigheid(page, 'odette')
  await page.close()
  assert.equal(vincent, 1, 'de uitgeklapte persoon staat op volle sterkte')
  assert.ok(odette < 1, `en de rest is gedempt (${odette})`)
})

test('een gedeelde balk toont de gezichten van de anderen in hun eigen stuk', { skip: skip ?? false }, async () => {
  // De balk was al in stukken verdeeld naar rato van de uren, maar met
  // alleen een '3p'-pill zag je wél dát het gedeeld was en niet mét wie,
  // laat staan wiens stuk waar zat. Je eigen hoofd hoeft er niet bij:
  // dit is jouw rij.
  const bord = [{ id: 'g1', name: 'Projecten', color: '#e2445c', items: [
    { id: 'i1', name: 'Landingspagina', ownerIds: ['menno', 'vincent', 'odette'],
      status: 'Working on it', estHours: 120, ownerHours: { menno: 60, vincent: 40, odette: 20 },
      startDate: iso(-2), endDate: iso(12), subitems: [] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
    sessionStorage.removeItem('planning-expanded-members')
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1500)

  const m = await page.evaluate(() => {
    const gezichten = [...document.querySelectorAll('[data-bar-owner]')]
    const balk = gezichten[0]?.parentElement?.getBoundingClientRect()
    return {
      ids: gezichten.map(e => e.getAttribute('data-bar-owner')),
      // Waar staat ieder gezicht, als fractie van de balkbreedte?
      posities: gezichten.map(e => {
        const r = e.getBoundingClientRect()
        return balk ? Math.round(((r.left + r.width / 2) - balk.left) / balk.width * 100) : -1
      }),
      pill: /\b3p\b/.test(document.body.innerText),
    }
  })
  await page.close()

  assert.deepEqual(m.ids, ['vincent', 'odette'],
    `alleen de anderen, niet Menno zelf — kreeg ${m.ids.join(', ')}`)
  // 60/40/20 van 120 → stukken van 50%, 33% en 17%. Menno's stuk staat
  // vooraan en blijft leeg; Vincent en Odette staan midden in het hunne.
  const [b, c] = m.posities
  assert.ok(Math.abs(b - 67) <= 4, `Vincent in zijn stuk (${b}%)`)
  assert.ok(Math.abs(c - 92) <= 4, `Odette in het hare (${c}%)`)
  assert.equal(m.pill, false, 'en de 3p-pill is overbodig geworden')
})

test('een balk die te krap is houdt de pill', { skip: skip ?? false }, async () => {
  // Past er geen gezicht in een stuk, dan zou je bij één zichtbaar
  // gezicht denken dat die persoon het alleen doet.
  const bord = [{ id: 'g1', name: 'Projecten', color: '#e2445c', items: [
    { id: 'i1', name: 'Kort klusje', ownerIds: ['menno', 'vincent', 'odette'],
      status: 'Working on it', estHours: 6, ownerHours: { menno: 2, vincent: 2, odette: 2 },
      startDate: iso(0), endDate: iso(0), subitems: [] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
    sessionStorage.removeItem('planning-expanded-members')
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1500)

  const m = await page.evaluate(() => ({
    gezichten: document.querySelectorAll('[data-bar-owner]').length,
    pill: /\b3p\b/.test(document.body.innerText),
  }))
  await page.close()
  assert.equal(m.gezichten, 0, 'geen half ingevulde strook')
  assert.equal(m.pill, true, 'maar wel het aantal mensen')
})

test('datumvelden beginnen met de dag, ook in een Engelse browser', { skip: skip ?? false }, async () => {
  // Een <input type="date"> volgt de taal van de browser, niet lang="nl".
  // In een Engelse Chrome stond er 11/04/2026 waar 4 november bedoeld is.
  const bord = [{ id: 'g1', name: 'Projecten', color: '#579bfc', items: [
    { id: 'p1', name: 'Testklus', ownerIds: ['menno'], status: 'Working on it',
      estHours: 8, startDate: '2026-11-04', endDate: '2026-11-19', subitems: [] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'en-US' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.locator('[data-item-id="p1"]').getByText(/nov\./).first().click()
  await page.waitForTimeout(900)

  const velden = page.locator('input[placeholder="dd-mm-jjjj"]')
  const waarden = await velden.evaluateAll(els => els.map(e => e.value))
  assert.deepEqual(waarden, ['04-11-2026', '19-11-2026'],
    `dag eerst, kreeg ${waarden.join(' / ')}`)

  // En intikken werkt in dezelfde volgorde.
  await velden.first().fill('25-12-2026')
  await velden.first().blur()
  await page.waitForTimeout(700)
  const opgeslagen = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-board-yoko')).flatMap(g => g.items).find(i => i.id === 'p1').startDate)
  await page.close()
  assert.equal(opgeslagen, '2026-12-25', '25-12 is 25 december, geen 12 mei')
})
