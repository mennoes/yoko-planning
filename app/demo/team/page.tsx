// /demo/team draait exact dezelfde pagina als /team.
//
// Hier stond een handmatige kopie van 606 regels — ~88% identiek aan
// app/team/page.tsx. De verschillen zaten in de databronnen: andere
// localStorage-sleutels, geen Supabase, verzonnen contacten in plaats van
// data/contacts.json, en geen terugval op de echte namen in
// data/team.json. Dat eerste regelen de stores nu zelf (lib/demoRoute.ts),
// de rest staat als één `isDemo`-tak in de gedeelde pagina.
export { default } from '@/app/team/page'
