import test from 'node:test'
import assert from 'node:assert/strict'
import {
  episodeKeyFromItemName,
  normalizeEditor,
  normalizeTopic,
  parseMasterPlanningCsv,
} from '../lib/masterPlanningSync.ts'

const csv = [
  ',"9","HU6","NWA 4","15"',
  ',"El Nino","God/geloof (voor kerst)","Niet meenemen",""',
  ',"Eliane (omgewisseld met 7)","Rosa","Iemand","FREELANCE\\n(+Loes)"',
  '"Sun 15-Nov",,,,',
  '"Mon 16-Nov","ANIMEREN",,,',
  '"Tue 17-Nov","ANIMEREN","ANIMEREN + SOUNDSCAPE",,',
  '"Mon 30-Nov","video naar AD","video naar AD",,',
  '"Thu 31-Dec",,,,',
  '"Fri 1-Jan",,,,',
  '"Mon 11-Jan",,,,"ANIMEREN"',
].join('\n')

test('masterplanning leest Onderzoekt en HeyU, maar geen NWA', () => {
  const episodes = parseMasterPlanningCsv(csv, 2026)
  assert.deepEqual(episodes.map(episode => episode.key), ['uvnl-s05-e09', 'heyu-s02-e06', 'uvnl-s05-e15'])
  assert.equal(episodes[0].startDate, '2026-11-16')
  assert.equal(episodes[0].deadline, '2026-11-30')
  assert.equal(episodes[1].name, 'HEY U S02 E06 (God/geloof)')
  assert.equal(episodes[1].estHours, 16)
})

test('een jaarwisseling in de rijen zet januari in het volgende jaar', () => {
  const episodes = parseMasterPlanningCsv(csv, 2026)
  assert.equal(episodes[2].startDate, '2027-01-11')
})

test('namen en redacteuren worden bruikbaar maar voorzichtig opgeschoond', () => {
  assert.equal(normalizeTopic('Marieke Dewitte (Seksueel plezier)', 'heyu'), 'Seksueel plezier')
  assert.equal(normalizeTopic('HEY U Dromen (Merijn vd Laar)', 'heyu'), 'Dromen')
  assert.equal(normalizeTopic('prikkelbaar darmsyndroom?', 'uvnl'), 'Prikkelbaar darmsyndroom')
  assert.equal(normalizeEditor('FREELANCE\n(+Loes)'), 'Loes')
  assert.equal(normalizeEditor('Anouk (omgewisseld met 6)'), 'Anouk')
})

test('bestaande Yoko-namen leveren een stabiele afleveringssleutel', () => {
  assert.equal(episodeKeyFromItemName('UvNL S05 E09 (El Nino)'), 'uvnl-s05-e09')
  assert.equal(episodeKeyFromItemName('HEY U S02 E12 (onderwerp volgt)'), 'heyu-s02-e12')
})
