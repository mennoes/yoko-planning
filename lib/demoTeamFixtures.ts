// Verzonnen contacten voor /demo/team.
//
// Hiervoor stond dit in lib/demoTeamPageStore.ts, een kopie van
// teamPageStore + capacitiesStore + profileDaysOff met andere
// localStorage-sleutels. Die kopie is weg: die stores kiezen hun sleutel
// nu zelf via lib/demoRoute.ts. Wat overblijft is waar de demo echt om
// draait — de verzonnen namen bij de verzonnen klanten.
//
// Niets hier mag een echte klant- of teamnaam bevatten.

import type { ContactGroup } from './teamPageStore'

export const DEMO_CONTACT_GROUPS: ContactGroup[] = [
  {
    id: 'gouw-bree', name: 'De Gouw & Bree', color: '#B0C6EB',
    contacts: [
      { id: 'barliman', name: 'Barliman Boterbloem', role: 'Herbergier', email: 'boterbloem@steigerendepony.example', phone: '' },
      { id: 'merry',    name: 'Meriadoc Brandebok',  role: 'Tweede ontbijt', email: '', phone: '' },
    ],
  },
  {
    id: 'rivendel-rohan', name: 'Rivendel & Rohan', color: '#D8935B',
    contacts: [
      { id: 'elrond', name: 'Elrond', role: 'Vergaderbaas', email: 'elrond@rivendel.example', phone: '' },
      { id: 'eomer',  name: 'Éomer',  role: 'Paardenplanning', email: 'eomer@rohan.example', phone: '' },
    ],
  },
  {
    id: 'gondor-mordor', name: 'Gondor & Mordor', color: '#5FA8A0',
    contacts: [
      { id: 'faramir', name: 'Faramir', role: 'Rangerplanning', email: 'faramir@gondor.example', phone: '' },
      { id: 'sauron',  name: 'Sauron',  role: 'Enig aanspreekpunt', email: 'oog@mordor.example', phone: '' },
    ],
  },
]
