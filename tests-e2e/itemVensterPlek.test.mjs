// Waar staat dit item? Het item-venster op een agenda liet alleen 'ITEM'
// en de naam zien. Open je zoiets vanuit een zoekactie of vanaf de
// planning, dan is dat een naam zonder plek: in welke agenda, in welke
// groep, en bij een subitem onder welk item.
//
// Het venster op /planning zei dit al ('in → bord · groep' en '↳ subitem
// van'); dat op de agenda niet.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [{ id: 'g1', name: 'Colleges', color: '#e2445c', items: [
  { id: 'p1', name: 'NL College S04 E33', ownerIds: ['menno'], status: 'Working on it', estHours: 16,
    startDate: iso(-1), endDate: iso(4), subitems: [
      { id: 's1', name: 'Standaard slide presentatie maken', ownerIds: ['menno'],
        status: 'Working on it', estHours: 8, startDate: iso(0), endDate: iso(4) },
    ] },
] }]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  return page
}

/** De kop van het geopende venster: soort, broodkruimel en naam. */
const vensterKop = (page, naam) => page.evaluate(zoek => {
  const titel = [...document.querySelectorAll('h2')].find(e => (e.textContent ?? '').includes(zoek))
  return (titel?.parentElement?.innerText ?? '').replace(/\n/g, ' | ')
}, naam)

test('het venster van een item noemt de agenda en de groep', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.locator('[data-item-id="p1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1000)
  const kop = await vensterKop(page, 'NL College S04 E33')
  await page.close()

  assert.match(kop, /^ITEM/, `het soort staat vooraan: ${kop}`)
  assert.match(kop, /Nederland/, `de agenda staat erbij: ${kop}`)
  assert.match(kop, /Colleges/, `en de groep ook: ${kop}`)
})

test('het venster van een subitem noemt ook het hoofditem', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.locator('[data-item-id="p1"] button').first().click()
  await page.waitForTimeout(800)
  await page.getByLabel('Reacties op subitem').first().click()
  await page.waitForTimeout(1000)
  const kop = await vensterKop(page, 'Standaard slide presentatie maken')
  await page.close()

  assert.match(kop, /^SUBITEM/, `het heet een subitem, geen item: ${kop}`)
  assert.match(kop, /Nederland.*Colleges.*NL College S04 E33/,
    `agenda, groep en hoofditem staan op volgorde: ${kop}`)
})

test('het venster geeft de velden lucht en de gezichten formaat', { skip: skip ?? false }, async () => {
  // Het venster voelde klein en onduidelijk: alle labels en waarden
  // liepen in één grijze soep in elkaar over, en de avatars waren even
  // klein als in een rij — terwijl hier ruimte zat is.
  const page = await openAgenda()
  await page.locator('[data-item-id="p1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1000)

  const m = await page.evaluate(() => {
    const titel = [...document.querySelectorAll('h2')].find(e => /NL College/.test(e.textContent ?? ''))
    const venster = titel?.closest('div[style*="position: fixed"]')
    const label = [...(venster?.querySelectorAll('span') ?? [])]
      .find(s => (s.textContent ?? '').trim() === 'OWNER' || (s.textContent ?? '').trim() === 'Owner')
    const vak = label?.parentElement
    const avatar = vak?.querySelector('img, [class*="avatar"], span[aria-hidden]')
    return {
      titelPx: titel ? Math.round(parseFloat(getComputedStyle(titel).fontSize)) : 0,
      vensterBreed: venster ? Math.round(venster.getBoundingClientRect().width) : 0,
      vakRand: vak ? getComputedStyle(vak).borderTopWidth : '',
      avatarPx: avatar ? Math.round(avatar.getBoundingClientRect().width) : 0,
    }
  })
  await page.close()

  // 22px sinds het venster compacter werd; het punt blijft dat de titel
  // groter is dan de tekst in een rij.
  assert.ok(m.titelPx >= 22, `de titel is niet meer muizig (${m.titelPx}px)`)
  assert.ok(m.vensterBreed >= 860, `en het venster heeft breedte (${m.vensterBreed}px)`)
  assert.notEqual(m.vakRand, '0px', 'elk veld staat in zijn eigen vlak')
  // Sinds het venster compacter werd zijn de gezichten 32px. Waar het om
  // gaat is dat ze een eigen formaat houden en niet terugvallen op de
  // 24px van een drukke rij.
  assert.ok(m.avatarPx >= 32, `de gezichten houden formaat (${m.avatarPx}px)`)
})

test('de taart telt op tot de uren die ernaast staan', { skip: skip ?? false }, async () => {
  // De klacht: een klus van 84.3u met een taart van 52u eronder. De
  // verdeling keek alleen naar subitems van de komende vijf weken, het
  // uren-veld naar alle.
  const ver = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const bord = [{ id: 'g1', name: 'Projecten', color: '#579bfc', items: [
    { id: 'p1', name: 'Greenpeace – PFAS', ownerIds: ['menno', 'vincent'], status: 'Working on it',
      startDate: null, endDate: null, subitems: [
        { id: 's1', name: 'Nu', ownerIds: ['menno'], status: 'Working on it', estHours: 26, startDate: ver(0), endDate: ver(5) },
        { id: 's2', name: 'Ook nu', ownerIds: ['vincent'], status: 'Working on it', estHours: 26, startDate: ver(0), endDate: ver(5) },
        // Ver voorbij de vijf-wekenhorizon: dit viel uit de taart.
        { id: 's3', name: 'Later', ownerIds: ['menno'], status: '', estHours: 32.3, startDate: ver(150), endDate: ver(160) },
      ] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.locator('[data-item-id="p1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1200)

  const m = await page.evaluate(() => {
    const tekst = document.body.innerText
    const taart = tekst.match(/(\d+(?:\.\d+)?)u\n/) // het getal in het hart van de taart
    const regels = [...tekst.matchAll(/(\d+(?:\.\d+)?)u · (\d+)%/g)].map(r => [Number(r[1]), Number(r[2])])
    return { taart: taart ? Number(taart[1]) : null, regels, heeftEstTime: /EST TIME/.test(tekst) }
  })
  await page.close()

  assert.ok(m.heeftEstTime, 'het venster staat open')
  assert.equal(m.taart, 84.3, `de taart telt alle subitems, niet alleen die van nu (${m.taart})`)
  const somRegels = Math.round(m.regels.reduce((a, [u]) => a + u, 0) * 10) / 10
  assert.equal(somRegels, 84.3, `en de regels ernaast ook (${m.regels.map(r => r.join('/')).join(', ')})`)
  // Menno doet 26 + 32.3 = 58.3 van de 84.3, Vincent 26.
  assert.deepEqual(m.regels.map(([u]) => u).sort((a, b) => a - b), [26, 58.3])
})

test('onderaan het venster staat de geschiedenis van het item', { skip: skip ?? false }, async () => {
  // Het venster op /planning liet dit al zien; hier stond je met een item
  // dat je niet herkent zonder enig spoor van waar het vandaan komt.
  const bord = [{ id: 'g1', name: 'Colleges', color: '#e2445c', items: [
    { id: 'p1', name: 'NL College S04 E33', ownerIds: ['menno'], status: 'Working on it',
      estHours: 16, createdAt: '2026-09-14T10:00:00Z', startDate: iso(-1), endDate: iso(4), subitems: [] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.locator('[data-item-id="p1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1200)

  const tekst = await page.evaluate(() => document.body.innerText)
  const volgorde = await page.evaluate(() => {
    const t = document.body.innerText
    return { notities: t.indexOf('NOTITIES'), geschiedenis: t.indexOf('GESCHIEDENIS') }
  })
  await page.close()

  assert.match(tekst, /GESCHIEDENIS/, 'de kop staat er')
  assert.match(tekst, /Aangemaakt op 14 september 2026/, 'met wanneer het item is gemaakt')
  assert.ok(volgorde.geschiedenis > volgorde.notities, 'onderaan, onder de notities')
})
