This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Loginwaarschuwingen

Voer `supabase/0038_login_devices.sql` eenmalig uit en configureer deze server-side omgevingsvariabelen in Vercel:

- `RESEND_API_KEY`
- `AUTH_ALERT_FROM_EMAIL` (bijvoorbeeld `Yoko Planner <beveiliging@studioyoko.nl>`; het domein moet in Resend geverifieerd zijn)
- `DEVICE_HASH_SECRET` (een willekeurige lange geheime waarde)
- optioneel `NEXT_PUBLIC_APP_URL` (de productie-URL, zonder slash aan het einde)

Na iedere geldige login registreert de server de browser. Een onbekende browser ontvangt één waarschuwing op het e-mailadres van de ingelogde gebruiker. IP-adressen worden alleen in die waarschuwing gebruikt en niet opgeslagen.

## Item aanmaken

Op een agenda staat een knop **Item aanmaken** (met het vonkje), en
hetzelfde vonkje verschijnt naast *+ Voeg item toe* zodra je daar met de
muis bent. Beide openen hetzelfde venster, met twee manieren om een item
met subitems te maken. Je ziet altijd eerst een voorstel: de stappen
staan als balkjes op een tijdlijn die je versleept — pak het midden om
een stap te verschuiven, een rand om 'm korter of langer te maken, en de
uren lopen mee met het aantal werkdagen. Pas een klik op *Aanmaken* zet
het op het bord, langs dezelfde weg als een item dat je met de hand
maakt.

**Uit een sjabloon** (altijd beschikbaar, gratis, niets gaat de deur
uit). Kies het soort klus, pas de stappen aan — één per regel, met het
aantal werkdagen erachter — en geef de datum waarop het af moet. De
werkdagen worden teruggeteld vanaf die datum, weekenden overgeslagen,
acht uur per dag. De sjablonen staan in `lib/sjabloonPlan.ts`.

**Uit een mail** (ook gratis). Plak een mail en `lib/mailNaarStappen.ts`
haalt eruit wat er staat: het onderwerp, een datum (woorden als
'uiterlijk' of 'deadline' wegen zwaarder dan de datum van het bericht
zelf) en de stappen. Die zoekt hij op drie manieren, in deze volgorde:

1. een lijstje met streepjes, bolletjes of nummers;
2. een zin met 'eerst … daarna … tot slot', of een opsomming op één
   regel ('1) script 2) storyboard');
3. losse regels die met een werkwoord beginnen ('Script schrijven').

Een aantal dagen achter een stap telt mee, in cijfers of woorden:
'(2 dagen)', '3 werkdagen', 'twee dagen', '1 week'. Namen van teamleden
die in de mail staan worden erbij genoemd. Levert geen van de drie iets
op maar herkent hij wel waar het over gaat ('explainer', 'podcast'), dan
komt dat sjabloon als beginpunt — met de melding dat het een gok is.

Staat er een `ANTHROPIC_API_KEY`, dan leest het model de mail (dat snapt
lopende tekst) en nemen de regels het over zodra dat niet lukt. De
melding zegt welke van de twee het was.

**Laten uitschrijven** (alleen met een sleutel). Je typt of plakt een
briefing en een model schrijft het voorstel. Dit tabblad verschijnt
alleen als deze server-side omgevingsvariabele in Vercel staat:

- `ANTHROPIC_API_KEY`
- optioneel `ANTHROPIC_MODEL` (standaard `claude-opus-5-5`)

Welk model je kiest bepaalt wat een voorstel kost. Ruwweg per voorstel,
bij een briefing van een paar zinnen:

| `ANTHROPIC_MODEL` | per voorstel | $5 aan tegoed |
| --- | --- | --- |
| `claude-haiku-5-5` | ongeveer een tiende cent | duizenden voorstellen |
| `claude-sonnet-5-5` | ongeveer 1 cent | honderden voorstellen |
| `claude-opus-5-5` (standaard) | ongeveer 2 cent | honderden voorstellen |

De sleutel blijft op de server: de browser praat met `/api/ai/plan`, nooit
rechtstreeks met de API. De route vraagt een ingelogde gebruiker en
schrijft zelf niets naar een bord.
