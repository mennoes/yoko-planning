import type { Project } from './workload'

function fmtDate(iso: string): string {
  return iso.replaceAll('-', '')
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

export function projectsToIcs(projects: Project[], title = 'Yoko Planning'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yoko//Planner//NL',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(title)}`,
  ]
  for (const p of projects) {
    if (!p.startDate || !p.endDate) continue
    // DTEND is exclusive in iCal all-day events: add one day
    const end = new Date(p.endDate); end.setDate(end.getDate() + 1)
    const endIso = end.toISOString().slice(0, 10)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@yoko-planning`,
      `SUMMARY:${escape(p.name)}${p.board ? ' [' + escape(p.board) + ']' : ''}`,
      `DTSTART;VALUE=DATE:${fmtDate(p.startDate)}`,
      `DTEND;VALUE=DATE:${fmtDate(endIso)}`,
      `DESCRIPTION:${escape(p.board ?? '')}${p.group ? ' / ' + escape(p.group) : ''}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadIcs(projects: Project[], filename = 'yoko-planning.ics') {
  const ics = projectsToIcs(projects)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.style.display = 'none'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}
