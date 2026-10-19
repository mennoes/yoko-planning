# Audit: minder complex, sneller, en vooral: sneller te wijzigen

Datum: 18 oktober 2026 · gemeten op commit van `claude/meeting-history-audit`

Alles hieronder is **gemeten**, niet geschat. Waar ik een getal noem staat erbij
hoe ik eraan kom, zodat je het zelf kan narekenen.

---

## Samenvatting in één alinea

De tooling is niet het probleem: een koude productiebuild duurt **34s**,
typecheck **22s**, de hele testsuite **7s**. Wat wél traag gaat is *iedere
wijziging die jij vraagt*, en daar zijn vier oorzaken voor, in deze volgorde van
pijn: (1) de hele demo-app is een **handmatige kopie** van de echte app — 14.461
van de 60.174 regels, dus elke wijziging moet twee keer, en dat ging deze sessie
meerdere keren mis; (2) de tests toetsen **broncode als tekst** in plaats van
gedrag — 626 regex-asserties tegen 342 echte, waardoor bijna elke refactor de
suite breekt zonder dat er iets stuk is; (3) twee bestanden van 6.400 en 7.582
regels met 92 resp. 118 `useState` en 52 resp. 33 `useEffect`, waarin je niets
kan aanraken zonder iets anders te raken; (4) de browser krijgt ~1,5 MB
JavaScript én de volledige seed-data mee, en rendert tot 8.161 DOM-nodes op één
pagina.

---

## 1. De demo-app is een kopie, geen variant — grootste rem op wijzigingen

**Meting**

| | regels |
|---|---|
| `app/` + `components/` + `lib/` totaal | 60.174 |
| `app/demo/**` | 12.620 |
| `components/Demo*.tsx` | 1.841 |
| **demo-footprint** | **14.461 (24%)** |

Per pagina, met `diff` tussen demo en echt:

| demo-bestand | regels | waarvan identiek aan de echte pagina |
|---|---|---|
| `app/demo/planning/page.tsx` | 6.814 | ~6.163 (90%) |
| `components/DemoHomePage.tsx` | 1.564 | ~1.451 (93%) |
| `app/demo/todos/page.tsx` | 1.610 | ~1.400 (87%) |
| `app/demo/budget/page.tsx` | 674 | ~603 (89%) |
| `app/demo/team/page.tsx` | 606 | ~534 (88%) |

**Waarom dit jou direct raakt.** Elke vraag van jou ("week-nav naar links",
"groepen op de plek van de weken", "+ in de lege kolom") is twee
implementaties. Deze sessie heb ik de demo-kant meerdere keren niet meegenomen —
niet uit luiheid, maar omdat niets dat afdwingt. De demo drijft dus langzaam weg
van de echte app, en wordt daarmee een steeds slechtere demo.

**Wat ik zou doen.** Niet "demo opruimen", maar de bron van de data omdraaien:
één pagina, en de vraag "echt of demo?" wordt een *provider* hoog in de boom.
Concreet: `lib/boardStore.ts` en `lib/demoBoardStore.ts` (33 resp. 32
localStorage-aanroepen, bijna regel-voor-regel hetzelfde) achter één interface,
en `app/demo/planning/page.tsx` wordt `app/planning/page.tsx` met
`<DataSource kind="demo">`. Verwachte winst: **~13.000 regels weg**, en elke
toekomstige wijziging is één keer.

Dit is veel werk (schatting: 2–3 sessies) maar het is de enige post die *alle*
latere wijzigingen sneller maakt.

---

## 2. De tests toetsen tekst, niet gedrag — stille rem

**Meting**

| | aantal |
|---|---|
| testbestanden | 66 |
| bestanden die broncode inlezen met `readFileSync` | **60** |
| `assert.match` / `doesNotMatch` op broncode | **626** |
| asserties op werkelijk gedrag (functie aanroepen, uitkomst checken) | 342 |

Een typisch voorbeeld (`tests/planningTeamDrag.test.mjs`):

```js
assert.match(planning, /aria-label=\{`Sleep \$\{member\.name\} naar een ander team`\}/)
assert.equal((planning.match(/planningTeamDragHandle\((?:m|member)\)/g) ?? []).length, 1)
```

Dit faalt als ik de aria-label herformuleer of de variabele hernoem — terwijl
het gedrag identiek is. En het slaagt als de functie bestaat maar niets doet.
Het is dus tegelijk te streng en te los. Deze sessie heb ik om deze reden
`planningTeamDrag`, `todosHomeParity`, `todosLayout`, `googleDeletedItems` en
`planningPopupRows` moeten bijwerken zonder dat er een bug in zat: pure
verspilling, en het ergste: het maakt me *voorzichtig* met refactoren, wat
precies het tegenovergestelde is van wat je wil.

**Wat ik zou doen.** De regels in `lib/` zijn al puur en testbaar — daar staan
de 342 goede asserties. Voor de UI-eisen: de 626 broncode-regexen vervangen
door een handvol echte tests. Voorstel: Playwright (nog geen dependency van het
project, maar wel beschikbaar in de buildomgeving — ik gebruik het deze sessie al
om te meten); tien flow-tests ("item verwijderen blijft weg
na refresh", "agenda hernoemen blijft staan", "uren Home == uren Planning")
dekken meer af dan die 626 bij elkaar, en breken alleen als er écht iets stuk
is. Verwachte winst: refactoren wordt goedkoop, wat voorwaarde is voor punt 1 en 3.

---

## 3. Twee bestanden waarin alles samenkomt

**Meting**

| bestand | regels | `useState` | `useEffect` | `useMemo` | `memo()` | componenten in 't bestand |
|---|---|---|---|---|---|---|
| `app/planning/page.tsx` | 7.582 | 92 | 52 | 12 | 1 | 19 |
| `components/BoardTable.tsx` | 6.440 | 118 | 33 | 9 | **0** | 27 |
| `app/todos/page.tsx` | 1.892 | 34 | 15 | 0 | 0 | — |
| `app/page.tsx` | 1.716 | 25 | 9 | 0 | 0 | — |

Twee gevolgen, één voor jou merkbaar en één voor mij:

- **Merkbaar:** alle state zit in de buitenste component en bijna geen kind is
  gememoiseerd (`memo()`: 1 van 19, en 0 van 27). Eén toetsaanslag in een
  notitieveld hertekent dus de hele pagina. Dat is de "logheid" die je voelt
  bij typen en bij het open- en dichtklappen van groepen.
- **Voor mij:** 52 effecten in één bestand betekent dat ik bij elke wijziging
  moet uitzoeken welke andere effecten meeluisteren. Dat is waarom de
  verwijder-bug drie keer "gefixt" was voordat hij echt weg was, en de
  hernoem-bug vier keer: de oorzaak lag elke keer in een pad dat ik niet
  overzag.

**Wat ik zou doen.** Niet in één keer opsplitsen — dat is precies het
refactor-werk dat punt 2 nu bestraft. Maar wel in deze volgorde:

1. De **zware kinderen memoiseren** die al losse componenten zijn
   (`TimelineBars`, rij-componenten in `BoardTable`). Klein, meetbaar, geen
   gedragsverandering.
2. De state die alleen een popup aangaat **naar die popup verhuizen**
   (nu staat die in de paginacomponent, dus hertekent de popup de pagina).
3. Pas daarna de bestanden echt knippen, per domein: `planning/` wordt een map
   met `grid`, `detail-panel`, `people`, `workload`.

---

## 4. De browser krijgt te veel mee

**Meting** (productiebuild, Chromium, leeg cache)

| pagina | JS overgedragen | DOM-nodes | networkidle |
|---|---|---|---|
| `/` | 1.581 KB | 335 | 0,9 s |
| `/planning` | 1.540 KB | 5.398 | 1,2 s |
| `/todos` | 1.540 KB | 1.046 | 1,0 s |
| `/projects/yoko` | 1.786 KB | **8.161** | 1,3 s |

Twee concrete oorzaken:

**(a) De seed-data zit in de browserbundel.** `data/boards/*.json` is 364 KB en
wordt als `import` gebruikt in client-pagina's:

```
app/planning/page.tsx:9     import yokoRaw from '@/data/boards/yoko.json'
app/todos/page.tsx:26       import yokoRaw from '@/data/boards/yoko.json'
app/projects/yoko/page.tsx:7 import initialData from '@/data/boards/yoko.json'
```

Ik heb nagekeken of het echt meegaat: de tekst `"Witte Man"` uit `yoko.json`
staat in drie client-chunks van samen **197 KB**. Die data wordt in de praktijk
meteen overschreven door wat uit Supabase komt — hij is alleen nodig als
fallback en in `api/admin/import-boards`. Weghalen bij de client is
laaghangend fruit: **~200 KB per pagina** eraf, en de eerste render is niet
langer "oude seed-data, dan een sprong naar de echte data".

**(b) 8.161 DOM-nodes op de agenda-pagina.** Dat is ongeveer tien keer wat een
browser soepel houdt bij scrollen. Hier hoort windowing bij (alleen zichtbare
rijen renderen), maar dat is pas verstandig *na* punt 3 — in de huidige
`BoardTable` is er geen plek om het netjes in te hangen.

**(c) 424 localStorage-aanroepen** in `app/`+`components/`+`lib/`, waarvan 49 in
`app/planning/page.tsx` alleen. Elke aanroep is een synchrone
`JSON.parse`/`stringify` op de main thread, en er is geen gedeelde cache: dezelfde
sleutel wordt op meerdere plekken los gelezen. Eén dunne cache-laag
(lezen uit geheugen, schrijven gebundeld) haalt dit weg zonder dat er één
aanroep hoeft te verdwijnen.

---

## 5. Wat géén probleem is (en dus geen aandacht hoeft)

- **Build en CI.** 34s koude build, 22s typecheck, 7s tests, 312 tests groen.
  Daar valt niets te winnen.
- **Dependencies.** Vier runtime-dependencies (`next`, `react`, `react-dom`,
  `@supabase/supabase-js`). Geen bloat.
- **De `lib/`-laag.** De logica-bestanden zijn op `googleSync.ts` (1.801 regels)
  en `boardStore.ts` (1.513) na allemaal klein en puur. Dat is de gezondste hoek
  van de codebase en het bewijs dat de aanpak werkt — de UI-laag is simpelweg
  nooit op dezelfde manier opgeruimd.

---

## Voorgestelde volgorde

Gesorteerd op "hoeveel sneller maakt dit de *volgende* wijziging", niet op
hoeveel het oplevert op de weegschaal.

| # | Actie | Werk | Winst | Status |
|---|---|---|---|---|
| 1 | Seed-JSON uit de clientbundel | ~1 uur | −190 KB per pagina | **gedaan** |
| 2 | Agenda-rijen buiten beeld uit de layout houden | ~2 uur | in-/uitklappen ~40% sneller | **gedaan** |
| 2b | Hydration-mismatch op elke pagina | ~1 uur | React gooit de server-HTML niet meer weg | **gedaan** (niet voorzien, pas tijdens het meten gevonden) |
| 3 | Broncode-regexen vervangen door flow-tests | halve sessie | refactoren wordt goedkoop; voorwaarde voor 4 en 5 | **begonnen** — zie hieronder |
| 4 | Demo en echt samenvoegen achter één data-provider | 2–3 sessies | **−13.000 regels**, elke wijziging één keer i.p.v. twee | open |
| 5 | `planning/page.tsx` en `BoardTable.tsx` knippen per domein | 2 sessies | 52 effecten worden overzienbaar | open |
| 6 | Windowing op de agenda-rijen | halve sessie | nog minder DOM; alleen nodig als 2 niet genoeg blijkt | open |

### Wat er van 3 af is

`tests-e2e/` is nieuw: flow-tests die in een echte browser op een
productiebuild klikken, met `npm run e2e`. Ze draaien bewust **niet** mee in
`npm test` en dus niet in de Vercel-build — daar is geen browser.

Negen tests, waarvan acht groen en één die zichzelf overslaat met uitleg
(het gelukte hernoem-pad heeft een database nodig). Ze leggen precies de
bugs vast die deze week bleven terugkomen: het kruisje vraagt om
bevestiging, een verwijdering die niet opgeslagen kan worden zet het item
terug én zegt waarom, een hernoeming springt nooit stil terug, de sticky
naamkolom blijft op mobiel staan, en rijen buiten beeld blijven klikbaar.

Daar horen twee echte prestatiemetingen bij, met ruime drempels (1 seconde)
die de regressies vangen die we gehad hebben:

```
planning uitklappen:   102ms   (was 1950ms vóór de bord-index)
agenda groep klappen:  185ms
```

In ruil is `tests/planningPersonalTimelinePerformance.test.mjs` opgeschoond
en hernoemd naar `tests/agendaColumnsAndPersonalStatus.test.mjs`. Dat
bestand heette 'performance' maar bevatte geen enkele meting: het legde de
vórm van de oplossing vast (`const parentItemsByBoard = new Map<...>`,
`const WorkloadCell = memo(...)`). Die drie tests zijn weg; de 'deze functie
is er niet meer'-wachters staan er nog, want die zijn wél stabiel.

Netto drie tests minder in `npm test` (312 → 309) en negen echte flow-tests
erbij. Er staan nog ~600 broncode-regexen in de andere 59 bestanden; die
gaan het beste om wanneer je het stuk code eromheen toch aanraakt.
