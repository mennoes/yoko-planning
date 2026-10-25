// De secties op de teampagina.
//
// Twee dingen die daar niet klopten: freelancers stonden onder
// 'Freelance' of 'Inactief' op grond van een handmatig vinkje — niet op
// grond van hun werk, zoals de planning het al deed — en de volgorde van
// de secties stond hard in de pagina, dus wat je in de planning instelde
// deed hier niets.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = offset => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// Marieke werkt deze week, Michel niet. Beiden zijn freelancer (ze staan
// niet in de Yoko-set), dus hun plek hangt alleen van dit werk af.
const BORD = [{
  id: 'g1', name: 'Testgroep', color: '#579bfc',
  items: [
    { id: 'i1', name: 'Werk van nu', ownerIds: ['marieke'], status: 'Working on it', estHours: 8, startDate: iso(1), endDate: iso(3), subitems: [] },
    { id: 'i2', name: 'Lang geleden', ownerIds: ['michel'], status: 'Done', estHours: 8, startDate: iso(-200), endDate: iso(-190), subitems: [] },
  ],
}]

async function openTeam(groepen = []) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 }, colorScheme: 'light' })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', payload.board)
    localStorage.setItem('yoko-team-groups', payload.groepen)
  }, { board: JSON.stringify(BORD), groepen: JSON.stringify(groepen) })
  await page.goto(BASE_URL + '/team', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}

/** De sectiekoppen in de volgorde waarin ze op de pagina staan. */
const koppen = page => page.evaluate(() =>
  [...document.querySelectorAll('span')]
    .filter(el => el.childElementCount === 0 && /· \d+$/.test((el.textContent ?? '').trim()))
    .map(el => el.textContent.trim()))

test('een freelancer met recent werk staat bij Freelancers, de rest bij Inactief team',
  { skip: skip ?? false }, async () => {
  const page = await openTeam()
  const lijst = await koppen(page)

  // Niemand heeft hier een handmatig vinkje gekregen: de indeling komt
  // volledig uit het werk in de agenda.
  assert.deepEqual(lijst, ['Studio Yoko · 5', 'Freelancers · 1', 'Inactief team · 5'])

  const namen = sectie => page.evaluate(kop => {
    const span = [...document.querySelectorAll('span')]
      .find(el => (el.textContent ?? '').trim() === kop)
    const blok = span.closest('div').parentElement
    return [...blok.querySelectorAll('*')]
      .map(el => el.childElementCount === 0 ? (el.textContent ?? '').trim() : '')
      .filter(Boolean)
  }, sectie)

  assert.ok((await namen('Freelancers · 1')).includes('Marieke'), 'Marieke werkt deze week')
  assert.ok((await namen('Inactief team · 5')).includes('Michel'), 'Michel al 200 dagen niet')
  await page.close()
})

test('de volgorde van de secties is hier aan te passen', { skip: skip ?? false }, async () => {
  const page = await openTeam()
  assert.deepEqual(await koppen(page), ['Studio Yoko · 5', 'Freelancers · 1', 'Inactief team · 5'])

  // De bovenste sectie heeft geen werkende pijl omhoog (en dus een andere
  // tooltip), dus de eerste 'Omhoog' is die van Freelancers.
  await page.getByTitle('Omhoog').first().click()
  await page.waitForTimeout(700)
  assert.deepEqual(await koppen(page), ['Freelancers · 1', 'Studio Yoko · 5', 'Inactief team · 5'],
    'Freelancers staat nu bovenaan')

  // En in dezelfde opslag die de planning en de to do's lezen.
  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-team-groups'))
      .sort((a, b) => a.position - b.position).map(g => g.name))
  assert.deepEqual(bewaard.slice(0, 2), ['Freelancers', 'Studio Yoko'])

  await page.close()
})

test('een eerder opgeslagen volgorde wordt gevolgd', { skip: skip ?? false }, async () => {
  // Zoals de volgorde eruitziet nadat je 'm in de planning hebt gezet:
  // dezelfde opslag, dus de teampagina hoort 'm over te nemen.
  const page = await openTeam([
    { id: '__freelance__', name: 'Freelancers',   color: '#9aadbd', position: 0, memberIds: [] },
    { id: '__yoko__',      name: 'Studio Yoko',   color: '#579bfc', position: 1, memberIds: [] },
    { id: '__inactive__',  name: 'Inactief team', color: '#8a919c', position: 2, memberIds: [] },
  ])
  assert.deepEqual(await koppen(page), ['Freelancers · 1', 'Studio Yoko · 5', 'Inactief team · 5'])
  await page.close()
})

test('een eigen team doet in dezelfde lijst mee', { skip: skip ?? false }, async () => {
  const page = await openTeam([
    { id: 'onderzoek', name: 'Onderzoek', color: '#e2445c', position: 1, memberIds: ['vincent'] },
  ])
  assert.deepEqual(await koppen(page),
    ['Studio Yoko · 4', 'Onderzoek · 1', 'Freelancers · 1', 'Inactief team · 5'])

  // Het eigen team omhoog, langs Studio Yoko.
  await page.getByTitle('Omhoog').first().click()
  await page.waitForTimeout(700)
  assert.deepEqual(await koppen(page),
    ['Onderzoek · 1', 'Studio Yoko · 4', 'Freelancers · 1', 'Inactief team · 5'])
  await page.close()
})
