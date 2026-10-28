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

## Item laten uitschrijven (AI)

Op een agenda staat een knop **✨ Item uitschrijven**: je typt wat er moet
gebeuren en krijgt een voorstel voor één item met subitems, datums, uren
en eigenaren. Je ziet het voorstel eerst; pas een klik op *Aanmaken* zet
het op het bord, langs dezelfde weg als een item dat je met de hand
maakt.

De knop verschijnt alleen als deze server-side omgevingsvariabele in
Vercel staat:

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
schrijft zelf niets naar een bord. Zonder sleutel antwoordt hij dat de
planner uitstaat en blijft de knop weg.
