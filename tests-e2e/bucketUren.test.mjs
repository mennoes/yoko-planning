// De urentotalen boven een ingeklapt blok (Opkomend / Afgerond).
//
// Die stonden achter de tekst geplakt — 'OPKOMEND (2) · 40U' — terwijl er
// een Est-kolom is waar precies zulke getallen horen. Dan staat het totaal
// van een blok ergens anders dan het totaal van de rijen eronder en van de
// Som-rij, en kun je ze niet met één blik vergelijken.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [{ id: 'g1', name: 'Lopend', color: '#579bfc', items: [
  { id: 'i1', name: 'UvNL S05 E09', ownerIds: ['menno'], status: 'Working on it', estHours: 24,
    startDate: iso(-2), endDate: iso(1), subitems: [] },
  { id: 'i2', name: 'Komt eraan A', ownerIds: ['menno'], status: '', estHours: 16,
    startDate: iso(40), endDate: iso(50), subitems: [] },
  { id: 'i3', name: 'Komt eraan B', ownerIds: ['menno'], status: '', estHours: 24,
    startDate: iso(60), endDate: iso(70), subitems: [] },
  { id: 'i4', name: 'Allang klaar', ownerIds: ['menno'], status: 'Done', estHours: 485.5,
    startDate: iso(-90), endDate: iso(-85), subitems: [] },
] }]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  return page
}

/** Het midden van de cel die 'tekst' bevat, binnen 'wortel'. */
const meting = page => page.evaluate(() => {
  const midden = el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2) }
  const cel = (wortel, isHet) => {
    const el = [...(wortel?.querySelectorAll('*') ?? [])]
      .find(e => e.children.length === 0 && isHet((e.textContent ?? '').trim()))
    return el ? midden(el) : null
  }
  const kop = naam => [...document.querySelectorAll('button')]
    .find(b => new RegExp(naam, 'i').test(b.textContent ?? ''))
  const rij = [...document.querySelectorAll('div')]
    .find(d => d.style.display === 'grid' && /UvNL S05 E09/.test(d.textContent ?? ''))
  return {
    rijEst:      cel(rij, t => t === '24'),
    opkomendEst: cel(kop('Opkomend'), t => t === '40u'),
    afgerondEst: cel(kop('Afgerond'), t => t === '485.5u'),
    opkomendTekst: kop('Opkomend')?.textContent ?? '',
  }
})

test('het urentotaal van een blok staat in de Est-kolom', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  const m = await meting(page)
  await page.close()

  assert.ok(m.rijEst, 'de Est-waarde van een gewone rij is te vinden')
  assert.ok(m.opkomendEst, `het totaal van Opkomend staat als los getal in een cel, kreeg: ${m.opkomendTekst}`)
  assert.equal(m.opkomendEst, m.rijEst, 'en recht onder de Est-waarde van de rijen')
  assert.ok(m.afgerondEst, 'ook voor het Afgerond-blok')
  assert.equal(m.afgerondEst, m.rijEst)
})

test('ook het Done-blok binnen een item zet zijn uren in de Est-kolom', { skip: skip ?? false }, async () => {
  const sub = (id, naam, status, uren) => ({
    id, name: naam, ownerIds: ['menno'], status,
    startDate: iso(1), endDate: iso(2), estHours: uren,
  })
  const bord = [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Ouder A', ownerIds: ['menno'], status: 'Working on it', estHours: 28,
      startDate: iso(0), endDate: iso(6),
      subitems: [sub('s1', 'Montage', 'Working on it', 16), sub('s2', 'Research', 'Done', 8), sub('s3', 'Script', 'Done', 4)] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.locator('[data-item-id="p1"] button').first().click().catch(() => {})
  await page.waitForTimeout(800)

  const m = await page.evaluate(() => {
    const midden = el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2) }
    const kop = [...document.querySelectorAll('button')].find(b => /Done \(2\)/.test(b.textContent ?? ''))
    const cel = kop && [...kop.children].find(c => (c.textContent ?? '').trim() === '12u')
    const sub = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && (e.textContent ?? '').trim() === 'Montage')
    const rij = sub?.closest('div[style*="grid"]')
    const est = rij && [...rij.querySelectorAll('*')]
      .find(e => e.children.length === 0 && (e.textContent ?? '').trim() === '16')
    return { kopTekst: kop?.textContent ?? '', doneX: cel ? midden(cel) : null, estX: est ? midden(est) : null }
  })
  await page.close()

  assert.ok(m.doneX, `12u staat als los getal in een cel, kreeg: ${m.kopTekst}`)
  assert.ok(m.estX, 'en de Est-waarde van een subitem is te vinden')
  assert.equal(m.doneX, m.estX, 'allebei in dezelfde kolom')
})

test('het getal houdt zijn kleine letter, net als in de Som-rij', { skip: skip ?? false }, async () => {
  // De kop staat in kapitalen; zonder uitzondering werd '485.5u' '485.5U'
  // en las dat raar naast de Som eronder.
  const page = await openAgenda()
  const tekst = await page.evaluate(() => {
    const kop = [...document.querySelectorAll('button')].find(b => /Afgerond/i.test(b.textContent ?? ''))
    return [...(kop?.querySelectorAll('*') ?? [])]
      .filter(e => e.children.length === 0).map(e => (e.textContent ?? '').trim()).join('|')
  })
  await page.close()
  assert.ok(tekst.includes('485.5u'), `verwacht een kleine u, kreeg: ${tekst}`)
})
