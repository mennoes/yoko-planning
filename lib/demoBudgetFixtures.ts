// Verzonnen startdata voor de budgetpagina op /demo.
//
// Hiervoor stond dit in lib/demoBudgetStore.ts, een complete kopie van
// budgetStore + projectRevenueStore + revenueTemplateStore met andere
// localStorage-sleutels. Die kopie is weg: de echte stores kiezen nu zelf
// hun sleutel en slaan hun remote-calls over zodra je op /demo zit. Wat
// overblijft is waar de demo écht om draait — de verzonnen bedragen.
//
// Niets hier mag een echte klant- of teamnaam bevatten.

import type { BudgetEntry } from './budgetStore'
import type { ProjectRevenue } from './projectRevenueStore'

/** Sam en Jules spelen op /demo de rol die menno/vincent in het echt
 *  spelen: de twee leden die in buildDemoBoards() het vaakst eigenaar
 *  zijn, zodat de pagina bij een eerste bezoek gevuld is in plaats van
 *  leeg of 'geen toegang'. */
export const DEMO_BUDGET_ALLOWED_MEMBER_IDS = ['demo-sam', 'demo-jules']

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function currentQuarter(): string {
  const d = new Date()
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}

export function demoBudgetSeed(): BudgetEntry[] {
  const now = new Date().toISOString()
  const q = currentQuarter()
  return [
    { id: genId('demobud'), memberId: 'demo-sam',   quarter: q, amount: 1200, label: 'Spoedtoeslag — orks vóór zonsopgang gepland', createdAt: now, updatedAt: now },
    { id: genId('demobud'), memberId: 'demo-jules', quarter: q, amount: 750,  label: 'Extra workshop — tweede ontbijt automatiseren', createdAt: now, updatedAt: now },
  ]
}

/** itemId-vorm `${boardId}__${item.id}`, zoals de pagina 'm zelf bouwt.
 *  De items komen uit buildDemoBoards() in lib/demoFixtures.ts. */
export function demoRevenueSeed(): ProjectRevenue[] {
  const now = new Date().toISOString()
  return [
    { itemId: 'De Gouw & Bree__i4',    boardId: 'De Gouw & Bree',   amount: 1800, confirmed: true,  updatedAt: now },
    { itemId: 'De Gouw & Bree__i6',    boardId: 'De Gouw & Bree',   amount: 950,  confirmed: true,  updatedAt: now },
    { itemId: 'De Gouw & Bree__i7',    boardId: 'De Gouw & Bree',   amount: 600,  confirmed: false, updatedAt: now },
    { itemId: 'Rivendel & Rohan__i35', boardId: 'Rivendel & Rohan', amount: 4200, confirmed: true,  updatedAt: now },
    { itemId: 'Rivendel & Rohan__i36', boardId: 'Rivendel & Rohan', amount: 8900, confirmed: false, updatedAt: now },
  ]
}
