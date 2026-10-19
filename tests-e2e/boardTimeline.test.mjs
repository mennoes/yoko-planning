// De Tijdlijn-weergave van één agenda.
//
// Dezelfde items als in de Lijst, maar als balken over de tijd. Het
// verschil met /planning is wat een rij betekent: daar een persoon
// ('wie heeft het te druk'), hier een item ('wat loopt wanneer').

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [
  { id: 'g1', name: 'Colleges', color: '#9c7ee8', items: [
    { id: 'i1', name: 'NL College S04 E33', ownerIds: ['menno'], status: 'Working on it', estHours: 16,
      startDate: iso(-3), endDate: iso(4), subitems: [] },
    { id: 'i3', name: 'Nog te plannen klus', ownerIds: [], status: '', estHours: 0,
      startDate: null, endDate: null, subitems: [] },
  ] },
  { id: 'g2', name: 'Shorts', color: '#e2445c', items: [
    { id: 'i4', name: 'FTI Shorts x14', ownerIds: ['odette'], status: 'Working on it', estHours: 40,
      startDate: iso(7), endDate: iso(35), subitems: [] },
    { id: 'i5', name: 'Allang klaar', ownerIds: ['odette'], status: 'Done', estHours: 8,
      startDate: iso(-90), endDate: iso(-85), subitems: [] },
  ] },
  // Een groep die 'Done' heet is een archief: alles erin is per definitie
  // afgerond, ook zonder dat elk item de status Done heeft.
  { id: 'g3', name: 'Done', color: '#00c875', items: [
    { id: 'i6', name: 'Archiefklus', ownerIds: ['menno'], status: '', estHours: 4,
      startDate: iso(-120), endDate: iso(-110), subitems: [] },
  ] },
]

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

/** Een bord met één item dat zijn werk in subitems heeft staan. */
const SUB_BORD = [{ id: 'g1', name: 'Colleges', color: '#9c7ee8', items: [
  { id: 'p1', name: 'Aflevering 9', ownerIds: ['menno'], status: 'Working on it', estHours: 40,
    startDate: iso(-2), endDate: iso(20), subitems: [
      { id: 's1', name: 'Research', ownerIds: ['menno'], status: 'Working on it', estHours: 16,
        startDate: iso(-2), endDate: iso(5) },
      { id: 's2', name: 'Montage', ownerIds: ['odette'], status: 'Working on it', estHours: 24,
        startDate: iso(8), endDate: iso(20) },
    ] },
] }]

/** `uitklappen` klikt de ouder open; standaard staat hij dicht, net als
 *  voor de gebruiker. */
async function openSubBord({ uitklappen = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(SUB_BORD))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)
  if (uitklappen) {
    await page.locator('[data-board-timeline] div[title^="Aflevering 9 ·"]').first().click()
    await page.waitForTimeout(600)
  }
  return page
}

/** De namen in het raster, van boven naar beneden. */
const namenInRaster = page => page.evaluate(() =>
  [...document.querySelectorAll('[data-board-timeline] button[title$="— open"]')]
    .map(b => (b.textContent ?? '').trim()))

test('de agenda heeft een schakelaar Lijst / Tijdlijn', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  assert.equal(await page.getByRole('button', { name: 'Lijst' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Tijdlijn' }).count(), 1)
  // Lijst is de startweergave; de Tijdlijn is iets wat je kiest.
  assert.equal(await page.getByRole('button', { name: 'Lijst' }).getAttribute('aria-pressed'), 'true')
  await page.close()
})

test('de tijdlijn toont een balk per item met de juiste periode', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const balken = await page.evaluate(() =>
    [...document.querySelectorAll('[data-board-timeline] [title*=" · "]')].map(b => b.getAttribute('title')))
  await page.close()

  assert.ok(balken.some(t => t.startsWith('NL College S04 E33 ·')), `verwacht een balk voor het college, kreeg: ${balken.join(' | ')}`)
  assert.ok(balken.some(t => t.startsWith('FTI Shorts x14 ·')), 'en één voor de shorts')
})

test('items zonder datum verdwijnen niet uit beeld', { skip: skip ?? false }, async () => {
  // Zonder deze lijst zou de Tijdlijn stilzwijgend minder tonen dan de
  // Lijst, en dat is precies hoe je items kwijtraakt.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const chip = page.getByRole('button', { name: 'Nog te plannen klus' })
  assert.equal(await chip.count(), 1, 'het item zonder datum staat er')
  const doos = await chip.first().boundingBox()
  await page.close()
  assert.ok(doos && doos.x > 0, `het staat ook echt in beeld (x=${doos?.x})`)
})

test('afgerond werk staat er standaard niet bij', { skip: skip ?? false }, async () => {
  // De klacht: de tijdlijn toonde letterlijk alles, ook werk van maanden
  // geleden waar je niets meer aan hebt. De lijst stopt dat al in een
  // ingeklapt 'Afgerond'-blok; de tijdlijn volgt nu dezelfde regel.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const namen = await page.evaluate(() =>
    [...document.querySelectorAll('[data-board-timeline] [title*=" · "]')].map(b => (b.getAttribute('title') ?? '').split(' ·')[0]))
  await page.close()

  assert.ok(namen.includes('NL College S04 E33'), 'lopend werk staat er')
  assert.ok(namen.includes('FTI Shorts x14'), 'en werk dat eraan komt ook')
  assert.ok(!namen.includes('Allang klaar'), 'een afgerond item niet')
  assert.ok(!namen.includes('Archiefklus'), 'en een item uit een Done-groep ook niet')
})

test('je kunt afgerond werk erbij zetten, en ziet hoeveel het er zijn', { skip: skip ?? false }, async () => {
  // Stilletjes minder tonen is hoe je denkt dat items verdwenen zijn, dus
  // de knop noemt het aantal.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const knop = page.getByRole('button', { name: /Afgerond \(/ })
  assert.equal(await knop.count(), 1, 'er staat een knop met het aantal')
  assert.match(await knop.first().textContent(), /Afgerond \(2\)/)

  await knop.first().click()
  await page.waitForTimeout(900)
  const namen = await page.evaluate(() =>
    [...document.querySelectorAll('[data-board-timeline] [title*=" · "]')].map(b => (b.getAttribute('title') ?? '').split(' ·')[0]))
  await page.close()

  assert.ok(namen.includes('Allang klaar'), 'nu staat het afgeronde werk er wel')
  assert.ok(namen.includes('Archiefklus'))
})

test('rijen zonder zichtbare balk staan niet in het raster', { skip: skip ?? false }, async () => {
  // De klacht: achttien rijen waarvan er vier een balk hadden. De rest
  // lag maanden in het verleden en stond links buiten beeld — een muur
  // van lege rijen bij vandaag.
  const iso2 = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const bord = [{ id: 'g1', name: 'Lopend', color: '#579bfc', items: [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `o${i}`, name: `Oud ${i}`, ownerIds: ['menno'], status: 'Working on it',
      estHours: 8, startDate: iso2(-200 + i * 8), endDate: iso2(-195 + i * 8), subitems: [],
    })),
    { id: 'n1', name: 'Loopt nu', ownerIds: ['menno'], status: 'Working on it', estHours: 40,
      startDate: iso2(-5), endDate: iso2(25), subitems: [] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(1000)

  const balken = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-board-timeline] [title*=" · "]')].filter(b => /\d/.test(b.getAttribute('title') ?? '')).length)
  assert.equal(await balken(), 1, 'alleen het werk dat nu loopt staat in het raster')

  const tekst = await page.evaluate(() => document.body.innerText)
  assert.match(tekst, /Eerder · 6/i, 'de rest staat in een blokje met het aantal')
  assert.match(tekst, /Oud 0/, 'en is daar gewoon aan te klikken')

  // Opvragen zet ze alsnog op de tijdlijn.
  await page.getByRole('button', { name: /Eerder ·/ }).click()
  await page.waitForTimeout(900)
  assert.equal(await balken(), 7, 'uitgeklapt loopt het raster terug en krijgt alles een balk')
  await page.close()
})

test('klikken op een balk opent de popup zonder van weergave te wisselen', { skip: skip ?? false }, async () => {
  // Eerst schakelde dit terug naar de Lijst en lichtte daar de rij op.
  // Dan ben je je plek in de tijd kwijt en moet je de popup alsnog zelf
  // openen.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  await page.getByRole('button', { name: /NL College S04 E33/ }).first().click()
  await page.waitForTimeout(1000)

  const actief = await page.evaluate(() =>
    document.querySelector('[role="group"][aria-label="Weergave"] button[aria-pressed="true"]')?.textContent)
  const popupOpen = await page.evaluate(() =>
    /Activiteit|Notities/i.test(document.body.innerText) && /NL College S04 E33/.test(document.body.innerText))
  await page.close()

  assert.equal(actief, 'Tijdlijn', 'je blijft in de tijdlijn staan')
  assert.ok(popupOpen, 'en de item-popup staat open')
})

test('de keuze wordt per agenda onthouden', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(600)
  assert.equal(await page.evaluate(() => localStorage.getItem('yoko-board-weergave-nederland')), 'tijdlijn')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const actief = await page.evaluate(() =>
    document.querySelector('[role="group"][aria-label="Weergave"] button[aria-pressed="true"]')?.textContent)
  // Een andere agenda houdt zijn eigen keuze.
  const anders = await page.evaluate(() => localStorage.getItem('yoko-board-weergave-yoko'))
  await page.close()

  assert.equal(actief, 'Tijdlijn', 'na een refresh sta je nog in de Tijdlijn')
  assert.equal(anders, null, 'en een andere agenda is daar niet door veranderd')
})

test('een balk verslepen verzet de datums, met behoud van de duur', { skip: skip ?? false }, async () => {
  // Zonder dit kun je in de tijdlijn alleen kijken, en dan is het een
  // slechtere versie van de planning.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const datums = () => page.evaluate(() => {
    const i = JSON.parse(localStorage.getItem('yoko-board-nederland'))
      .flatMap(g => g.items).find(x => x.id === 'i1')
    return `${i.startDate} → ${i.endDate}`
  })
  const voor = await datums()

  const balk = page.locator('div[title*="sleep om te verzetten"]').first()
  const doos = await balk.boundingBox()
  assert.ok(doos, 'de balk is te pakken')
  // Twee weekkolommen naar rechts.
  await page.mouse.move(doos.x + doos.width / 2, doos.y + doos.height / 2)
  await page.mouse.down()
  await page.mouse.move(doos.x + doos.width / 2 + 208, doos.y + doos.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(900)

  const na = await datums()
  await page.close()
  assert.notEqual(na, voor, 'de datums zijn verzet')
  const duur = d => { const [a, b] = d.split(' → '); return (Date.parse(b) - Date.parse(a)) / 86400000 }
  assert.equal(duur(na), duur(voor), 'en de klus duurt nog even lang')
})

test('de rand verslepen verandert alleen de einddatum', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const start = () => page.evaluate(() => JSON.parse(localStorage.getItem('yoko-board-nederland'))
    .flatMap(g => g.items).find(x => x.id === 'i1').startDate)
  const eind = () => page.evaluate(() => JSON.parse(localStorage.getItem('yoko-board-nederland'))
    .flatMap(g => g.items).find(x => x.id === 'i1').endDate)
  const startVoor = await start(); const eindVoor = await eind()

  const balk = page.locator('div[title*="sleep om te verzetten"]').first()
  const doos = await balk.boundingBox()
  await page.mouse.move(doos.x + doos.width - 3, doos.y + doos.height / 2)
  await page.mouse.down()
  await page.mouse.move(doos.x + doos.width - 3 + 104, doos.y + doos.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(900)

  const startNa = await start(); const eindNa = await eind()
  await page.close()
  assert.equal(startNa, startVoor, 'de startdatum blijft staan')
  assert.notEqual(eindNa, eindVoor, 'de einddatum schuift op')
})

test('verslepen is terug te draaien', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)
  const datums = () => page.evaluate(() => {
    const i = JSON.parse(localStorage.getItem('yoko-board-nederland'))
      .flatMap(g => g.items).find(x => x.id === 'i1')
    return `${i.startDate} → ${i.endDate}`
  })
  const voor = await datums()

  const doos = await page.locator('div[title*="sleep om te verzetten"]').first().boundingBox()
  await page.mouse.move(doos.x + doos.width / 2, doos.y + doos.height / 2)
  await page.mouse.down()
  await page.mouse.move(doos.x + doos.width / 2 + 208, doos.y + doos.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(900)
  assert.notEqual(await datums(), voor)

  await page.getByText(/Maak ongedaan/).first().click()
  await page.waitForTimeout(900)
  const na = await datums()
  await page.close()
  assert.equal(na, voor, 'ongedaan zet de oude datums terug')
})

test('onder de naam staat geen tweede regel meer', { skip: skip ?? false }, async () => {
  // Die regel gaf status en uren, maar dat voegde te weinig toe om er een
  // halve rij breder van te worden.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const naamknop = await page.evaluate(() => {
    const knop = [...document.querySelectorAll('[data-board-timeline] button')]
      .find(b => /NL College S04 E33/.test(b.textContent ?? ''))
    return (knop?.textContent ?? '').trim()
  })
  await page.close()
  assert.equal(naamknop, 'NL College S04 E33', 'alleen de naam, verder niets')
})

test('de hele rij licht op als je eroverheen gaat', { skip: skip ?? false }, async () => {
  // Met balken ver naar rechts en de naam links vastgeplakt verlies je
  // zonder dit welke naam bij welke balk hoort.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const rij = page.locator('[data-board-timeline] div').filter({ hasText: 'NL College S04 E33' })
  const kleuren = () => page.evaluate(() => {
    const knop = [...document.querySelectorAll('[data-board-timeline] button')]
      .find(b => /NL College S04 E33/.test(b.textContent ?? ''))
    const naamCel = knop?.parentElement
    const rijEl = naamCel?.parentElement
    const lees = el => el ? getComputedStyle(el).backgroundColor : ''
    return { rij: lees(rijEl), naam: lees(naamCel) }
  })
  const voor = await kleuren()
  await rij.last().hover()
  await page.waitForTimeout(250)
  const na = await kleuren()
  await page.close()

  assert.notEqual(na.rij, voor.rij, 'de rij zelf krijgt een andere achtergrond')
  assert.notEqual(na.naam, voor.naam, 'en de vastgeplakte naamkolom ook, anders valt die eruit')
})

test('je kunt kiezen welke groepen je ziet', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const namen = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-board-timeline] [title*=" · "]')]
      .map(b => (b.getAttribute('title') ?? '').split(' ·')[0]))
  assert.ok((await namen()).includes('FTI Shorts x14'))

  // De knop heet 'Shorts'; wat hij doet staat in de title.
  await page.getByTitle('Shorts verbergen').click()
  await page.waitForTimeout(600)
  const over = await namen()
  assert.ok(!over.includes('FTI Shorts x14'), 'de verborgen groep is uit het raster')
  assert.ok(over.includes('NL College S04 E33'), 'de andere groep staat er nog')

  await page.getByTitle('Shorts tonen').click()
  await page.waitForTimeout(600)
  const terug = await namen()
  await page.close()
  assert.ok(terug.includes('FTI Shorts x14'), 'en hij komt gewoon terug')
})

test('naar links scrollen laadt eerdere weken bij', { skip: skip ?? false }, async () => {
  // Eerder liep je tegen een harde rand: het raster begon drie weken terug
  // en verder terug kijken kon niet.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)

  const eersteKolom = () => page.evaluate(() => {
    const koppen = document.querySelectorAll('[data-board-timeline] div[style*="border-left"]')
    return koppen[0]?.textContent ?? ''
  })
  const voor = await eersteKolom()

  await page.evaluate(() => {
    const raster = [...document.querySelectorAll('[data-board-timeline] div')]
      .find(d => d.scrollWidth > d.clientWidth + 50)
    if (raster) raster.scrollLeft = 0
    raster?.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await page.waitForTimeout(900)
  const na = await eersteKolom()
  await page.close()
  assert.notEqual(na, voor, `het raster loopt verder terug (van ${voor} naar ${na})`)
})

test('de breedte van de item-popup is te verslepen en wordt onthouden', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: /NL College S04 E33/ }).first().click()
  await page.waitForTimeout(900)

  const breedte = () => page.evaluate(() => {
    const greep = document.querySelector('[title*="breder of smaller"]')
    return greep?.parentElement ? Math.round(greep.parentElement.getBoundingClientRect().width) : 0
  })
  const doos = await page.locator('[title*="breder of smaller"]').first().boundingBox()
  assert.ok(doos, 'er zit een sleepgreep op de rand')
  const voor = await breedte()

  // Naar links trekken maakt het venster breder.
  await page.mouse.move(doos.x + 3, doos.y + doos.height / 2)
  await page.mouse.down()
  await page.mouse.move(doos.x + 3 - 200, doos.y + doos.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const na = await breedte()
  assert.ok(na > voor + 100, `het venster is breder geworden (${voor} → ${na})`)

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: /NL College S04 E33/ }).first().click()
  await page.waitForTimeout(900)
  const naRefresh = await breedte()
  await page.close()
  assert.equal(naRefresh, na, 'en die breedte staat er na een refresh nog')
})

test('de eigenaren staan rechts van de titel', { skip: skip ?? false }, async () => {
  // Precies wat de planning wél liet zien en de tijdlijn niet. Ze stonden
  // eerst vóór de naam; dan begint elke naam op een andere x, afhankelijk
  // van hoeveel mensen eraan werken.
  const page = await openAgenda()
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)
  const m = await page.evaluate(() => {
    const knop = [...document.querySelectorAll('[data-board-timeline] button')].find(b => /NL College S04 E33/.test(b.textContent ?? ''))
    const cel = knop?.parentElement
    const avatar = cel?.querySelector('img, span[aria-hidden]')
    return {
      avatars: cel ? cel.querySelectorAll('img, span[aria-hidden]').length : 0,
      naamX:   knop ? Math.round(knop.getBoundingClientRect().left) : null,
      avatarX: avatar ? Math.round(avatar.getBoundingClientRect().left) : null,
    }
  })
  await page.close()
  assert.ok(m.avatars > 0, 'er staat minstens één eigenaar bij de naam')
  assert.ok(m.avatarX > m.naamX, `de avatar staat rechts van de titel (naam ${m.naamX}, avatar ${m.avatarX})`)
})

test('een item met subitems staat dicht, met een bolletje dat het aantal noemt', { skip: skip ?? false }, async () => {
  // Alles meteen openklappen maakt van het overzicht weer een lange
  // lijst. Maar aan een kale balk zie je niet dát er iets onder zit.
  const page = await openSubBord()
  const regels = await namenInRaster(page)
  const balk = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-board-timeline] div[title]')]
      .find(d => (d.getAttribute('title') ?? '').startsWith('Aflevering 9 ·'))
    return { titel: el?.getAttribute('title') ?? '', tekst: (el?.textContent ?? '').trim(),
      hoogte: el ? Math.round(el.getBoundingClientRect().height) : 0 }
  })
  await page.close()

  assert.ok(!regels.includes('Montage'), 'de subitems staan er nog niet')
  assert.ok(regels.includes('Aflevering 9'), 'het item zelf wel')
  assert.match(balk.tekst, /2$/, 'en op de balk staat het aantal subitems')
  assert.ok(balk.hoogte > 10, `het is een gewone volle balk, geen streepje (${balk.hoogte}px)`)
  assert.match(balk.titel, /2 subitems · klik om uit te klappen/)
})

test('klikken op de balk klapt de subitems uit en weer in', { skip: skip ?? false }, async () => {
  const page = await openSubBord()
  const balk = () => page.locator('[data-board-timeline] div[title^="Aflevering 9 ·"]').first()

  await balk().click()
  await page.waitForTimeout(600)
  assert.ok((await namenInRaster(page)).includes('Montage'), 'uitgeklapt staan de subitems er')

  await balk().click()
  await page.waitForTimeout(600)
  assert.ok(!(await namenInRaster(page)).includes('Montage'), 'nog een klik en hij is weer dicht')
  await page.close()
})

test('het pijltje naast de naam klapt ook uit', { skip: skip ?? false }, async () => {
  const page = await openSubBord()
  await page.getByTitle(/Aflevering 9 uitklappen/).click()
  await page.waitForTimeout(600)
  const regels = await namenInRaster(page)
  const dicht = await page.getByTitle('Aflevering 9 inklappen').count()
  await page.close()
  assert.ok(regels.includes('Research'), 'de subitems staan er')
  assert.equal(dicht, 1, 'en het pijltje biedt nu inklappen aan')
})

test('uitgeklapt toont het item zijn subitems als eigen regels', { skip: skip ?? false }, async () => {
  // Het werk zit in de subitems. De ouder zegt niet veel meer dan
  // 'ergens in deze twee maanden'.
  const page = await openSubBord({ uitklappen: true })
  const regels = await namenInRaster(page)
  await page.close()

  assert.ok(regels.includes('Aflevering 9'), 'de ouder staat er nog')
  assert.ok(regels.includes('Research'), 'en de subitems staan eronder')
  assert.ok(regels.includes('Montage'))
  assert.equal(regels.indexOf('Aflevering 9') < regels.indexOf('Research'), true, 'de ouder staat boven zijn subitems')
})

test('de ouderbalk is dun en grijs, de subitems springen eruit', { skip: skip ?? false }, async () => {
  const page = await openSubBord({ uitklappen: true })
  const balken = await page.evaluate(() => {
    const meet = naam => {
      const el = [...document.querySelectorAll('[data-board-timeline] div[title]')]
        .find(d => (d.getAttribute('title') ?? '').startsWith(`${naam} ·`))
      if (!el) return null
      const s = getComputedStyle(el)
      return { hoogte: Math.round(el.getBoundingClientRect().height), kleur: s.backgroundColor, dekking: Number(s.opacity) }
    }
    return { ouder: meet('Aflevering 9'), sub: meet('Montage') }
  })
  await page.close()

  assert.ok(balken.ouder && balken.sub, 'beide balken staan er')
  assert.ok(balken.ouder.hoogte < balken.sub.hoogte / 2,
    `de ouderbalk is veel dunner (${balken.ouder.hoogte}px vs ${balken.sub.hoogte}px)`)
  assert.ok(balken.ouder.dekking < balken.sub.dekking, 'en lichter')
  assert.notEqual(balken.ouder.kleur, balken.sub.kleur, 'grijs in plaats van de groepskleur')
})

test('een subitem verslepen verzet dat subitem, niet het hele item', { skip: skip ?? false }, async () => {
  const page = await openSubBord({ uitklappen: true })
  const opgeslagen = () => page.evaluate(() => {
    const item = JSON.parse(localStorage.getItem('yoko-board-nederland')).flatMap(g => g.items).find(i => i.id === 'p1')
    const sub = item.subitems.find(s => s.id === 's2')
    return { item: `${item.startDate} → ${item.endDate}`, sub: `${sub.startDate} → ${sub.endDate}` }
  })
  const voor = await opgeslagen()

  const balk = page.locator('[data-board-timeline] div[title^="Montage ·"]').first()
  const doos = await balk.boundingBox()
  assert.ok(doos, 'de subbalk is te pakken')
  await page.mouse.move(doos.x + doos.width / 2, doos.y + doos.height / 2)
  await page.mouse.down()
  await page.mouse.move(doos.x + doos.width / 2 + 208, doos.y + doos.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(900)

  const na = await opgeslagen()
  await page.close()
  assert.notEqual(na.sub, voor.sub, 'het subitem is verzet')
  assert.equal(na.item, voor.item, 'en de datums van het item zelf zijn niet aangeraakt')
})

test('een item met subitems belooft geen slepen, dicht noch open', { skip: skip ?? false }, async () => {
  // Zijn periode is de optelsom van de subitems; schuiven zou meteen weer
  // worden overschreven. Klap 'm uit en versleep het subitem dat je
  // bedoelt.
  const lees = page => page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-board-timeline] div[title]')]
      .find(d => (d.getAttribute('title') ?? '').startsWith('Aflevering 9 ·'))
    return el?.getAttribute('title') ?? ''
  })
  const dicht = await openSubBord()
  const titelDicht = await lees(dicht)
  await dicht.close()
  const open = await openSubBord({ uitklappen: true })
  const titelOpen = await lees(open)
  await open.close()

  for (const titel of [titelDicht, titelOpen]) {
    assert.ok(!/sleep om te verzetten/.test(titel), `belooft geen slepen, kreeg: ${titel}`)
    assert.match(titel, /klik om (uit|in) te klappen/, 'maar zegt wel wat klikken doet')
  }
})
