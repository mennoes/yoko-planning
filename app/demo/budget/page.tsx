// /demo/budget draait exact dezelfde pagina als /budget.
//
// Hier stond een handmatige kopie van 674 regels — 89% identiek aan
// app/budget/page.tsx, met als enige echte verschillen: andere
// localStorage-sleutels, geen Supabase, en twee andere teamleden die
// budget mogen zien. Die drie dingen zitten nu in de stores zelf
// (lib/budgetStore.ts, projectRevenueStore.ts, revenueTemplateStore.ts
// kijken via lib/demoRoute.ts of ze op /demo draaien), dus de pagina
// hoeft niet meer te bestaan in twee versies.
//
// Gevolg: een wijziging aan de budgetpagina hoeft nog maar één keer.
export { default } from '@/app/budget/page'
