// Datums in Nederlandse volgorde: dag, maand, jaar.
//
// Een <input type="date"> laat je die volgorde niet kiezen. De browser
// kijkt naar zijn eigen taalinstelling, niet naar lang="nl" op de
// pagina, dus met een Engelse Chrome staat er 11/04/2026 voor 4
// november — precies verkeerd om te lezen én in te tikken. Daarom een
// eigen tekstveld met deze twee functies eronder, en de kalender van de
// browser nog als knopje ernaast.

/** 'dd-mm-jjjj' uit een ISO-datum ('2026-11-04'). Leeg als er niets staat. */
export function naarNl(iso: string | null | undefined): string {
  if (!iso) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''
  return `${match[3]}-${match[2]}-${match[1]}`
}

function geldig(dag: number, maand: number, jaar: number): boolean {
  if (maand < 1 || maand > 12 || dag < 1 || jaar < 1900 || jaar > 2200) return false
  const d = new Date(jaar, maand - 1, dag)
  // Date rolt 31 februari door naar maart; zo vangen we dat af.
  return d.getFullYear() === jaar && d.getMonth() === maand - 1 && d.getDate() === dag
}

function iso(dag: number, maand: number, jaar: number): string {
  const pad = (n: number) => (n < 10 ? '0' : '') + n
  return `${jaar}-${pad(maand)}-${pad(dag)}`
}

/**
 * Leest wat iemand intikt en maakt er een ISO-datum van.
 *
 * Bewust ruim: scheidingsteken naar keuze (- / . of spatie), jaartal mag
 * weg (dan dit jaar) of tweecijferig, en helemaal zonder scheidingstekens
 * mag ook — '0411' en '04112026' typen is sneller dan klikken.
 *
 * Komt er geen geldige datum uit, dan null: de aanroeper zet dan terug
 * wat er stond in plaats van het veld leeg te maken.
 */
export function naarIso(invoer: string, vandaag = new Date()): string | null {
  const schoon = invoer.trim()
  if (schoon === '') return null

  const cijfers = schoon.replace(/[^\d]/g, '')
  const heeftScheiding = /[-/. ]/.test(schoon)

  if (!heeftScheiding) {
    if (cijfers.length === 4) {
      const dag = Number(cijfers.slice(0, 2)), maand = Number(cijfers.slice(2, 4))
      return geldig(dag, maand, vandaag.getFullYear()) ? iso(dag, maand, vandaag.getFullYear()) : null
    }
    if (cijfers.length === 6) {
      const dag = Number(cijfers.slice(0, 2)), maand = Number(cijfers.slice(2, 4))
      const jaar = 2000 + Number(cijfers.slice(4, 6))
      return geldig(dag, maand, jaar) ? iso(dag, maand, jaar) : null
    }
    if (cijfers.length === 8) {
      const dag = Number(cijfers.slice(0, 2)), maand = Number(cijfers.slice(2, 4))
      const jaar = Number(cijfers.slice(4, 8))
      return geldig(dag, maand, jaar) ? iso(dag, maand, jaar) : null
    }
    return null
  }

  const delen = schoon.split(/[-/. ]+/).filter(Boolean)
  if (delen.length < 2 || delen.length > 3) return null
  if (delen.some(deel => !/^\d{1,4}$/.test(deel))) return null

  const dag = Number(delen[0])
  const maand = Number(delen[1])
  let jaar = delen.length === 3 ? Number(delen[2]) : vandaag.getFullYear()
  if (delen.length === 3 && delen[2].length <= 2) jaar = 2000 + jaar
  return geldig(dag, maand, jaar) ? iso(dag, maand, jaar) : null
}
