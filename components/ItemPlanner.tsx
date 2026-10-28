'use client'

// Een klus uitzetten zonder alles met de hand te tikken.
//
// Twee manieren, hetzelfde venster: uit een sjabloon (stappen die je
// zelf aanpast, werkdagen teruggeteld vanaf de deadline — gratis en
// meteen klaar) of laten uitschrijven door een model, als daar een
// sleutel voor staat.
//
// Beide leveren een vóórstel: je ziet eerst wat er zou komen te staan,
// kunt subitems weggooien en de groep kiezen, en pas op Aanmaken gaat
// het naar het bord — langs dezelfde weg als een item dat je met de
// hand maakt.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useTeam } from './TeamContext'
import { UserAvatar } from './UserAvatar'
import { naarNl } from '@/lib/datumInvoer'
import { planToBoardItem, type AiItemPlan, type AiSubitemPlan } from '@/lib/aiPlan'
import {
  planUitSjabloon, stappenNaarTekst, tekstNaarStappen, SJABLONEN,
  verplaatsStap, rekStap, werkdagenIn, UREN_PER_DAG,
} from '@/lib/sjabloonPlan'
import { mailNaarStappen } from '@/lib/mailNaarStappen'
import { IconSpark } from './Icon'
import { DatumVeld } from './DatumVeld'
import type { BoardGroup, BoardItem } from '@/lib/boards'

/** Is de planner aangezet op deze installatie? Zonder sleutel op de
 *  server heeft de knop geen zin, dus die verschijnt dan niet. */
export function useAiPlannerAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let gestopt = false
    fetch('/api/ai/plan')
      .then(res => res.ok ? res.json() : { available: false })
      .then(data => { if (!gestopt) setAvailable(data?.available === true) })
      .catch(() => {})
    return () => { gestopt = true }
  }, [])
  return available
}

const vak: React.CSSProperties = {
  background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text-primary)', padding: '8px 10px', fontSize: 13, outline: 'none',
  boxSizing: 'border-box', width: '100%',
}

/** Hoeveel dagen zit er tussen twee ISO-datums. */
function dagenTussen(vanIso: string, totIso: string): number {
  return Math.round(
    (new Date(`${totIso}T00:00:00`).getTime() - new Date(`${vanIso}T00:00:00`).getTime()) / 86400000)
}

function dagErbij(iso: string, dagen: number): string {
  const datum = new Date(`${iso}T00:00:00`)
  datum.setDate(datum.getDate() + dagen)
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
}

/**
 * De stappen als balkjes die je kunt verslepen.
 *
 * Pak een balk in het midden om de hele stap te verschuiven, of een rand
 * om 'm korter of langer te maken. De uren lopen mee met het aantal
 * werkdagen; weekenden blijven leeg.
 */
function VoorstelTijdlijn({ subitems, onChange }: {
  subitems: AiSubitemPlan[]
  onChange: (subitems: AiSubitemPlan[]) => void
}) {
  const baan = useRef<HTMLDivElement>(null)
  const [sleep, setSleep] = useState<{ index: number; soort: 'verplaats' | 'start' | 'eind'; vanaf: number; dagen: number } | null>(null)

  const metDatum = subitems.filter(sub => sub.startDate && sub.endDate)
  if (metDatum.length === 0) return null

  // Twee dagen lucht aan weerskanten, zodat je ook naar buiten kunt slepen.
  const vroegste = metDatum.reduce((a, sub) => (sub.startDate! < a ? sub.startDate! : a), metDatum[0].startDate!)
  const laatste = metDatum.reduce((a, sub) => (sub.endDate! > a ? sub.endDate! : a), metDatum[0].endDate!)
  const van = dagErbij(vroegste, -2)
  const tot = dagErbij(laatste, 2)
  const totaalDagen = Math.max(1, dagenTussen(van, tot) + 1)

  function dagBreedte(): number {
    const breedte = baan.current?.getBoundingClientRect().width ?? 0
    return breedte > 0 ? breedte / totaalDagen : 0
  }

  function start(event: React.PointerEvent, index: number, soort: 'verplaats' | 'start' | 'eind') {
    event.preventDefault()
    event.stopPropagation()
    setSleep({ index, soort, vanaf: event.clientX, dagen: 0 })
    const breedte = dagBreedte()
    const beginX = event.clientX

    function beweeg(ev: PointerEvent) {
      if (breedte <= 0) return
      setSleep(vorig => vorig && { ...vorig, dagen: Math.round((ev.clientX - beginX) / breedte) })
    }
    function los(ev: PointerEvent) {
      window.removeEventListener('pointermove', beweeg)
      window.removeEventListener('pointerup', los)
      const dagen = breedte > 0 ? Math.round((ev.clientX - beginX) / breedte) : 0
      setSleep(null)
      if (dagen === 0) return
      const sub = subitems[index]
      if (!sub.startDate || !sub.endDate) return
      const nieuw = soort === 'verplaats'
        ? verplaatsStap(sub.startDate, sub.endDate, dagen)
        : rekStap(sub.startDate, sub.endDate, soort === 'start' ? 'start' : 'eind', dagen)
      onChange(subitems.map((entry, i) => i !== index ? entry : {
        ...entry,
        startDate: nieuw.startDate,
        endDate: nieuw.endDate,
        // De uren horen bij het aantal werkdagen; anders staat er straks
        // 8 uur op een stap van een week.
        estHours: Math.round(werkdagenIn(nieuw.startDate, nieuw.endDate) * UREN_PER_DAG * 10) / 10,
      }))
    }
    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
  }

  // De weekenden als lichte banen eronder, zodat je ziet waar je niet
  // hoort te plannen.
  const weekenden: Array<{ links: number; breed: number }> = []
  for (let i = 0; i < totaalDagen; i++) {
    const dag = new Date(`${dagErbij(van, i)}T00:00:00`).getDay()
    if (dag === 0 || dag === 6) weekenden.push({ links: (i / totaalDagen) * 100, breed: (1 / totaalDagen) * 100 })
  }

  return (
    <div data-voorstel-tijdlijn style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {subitems.map((sub, index) => {
        if (!sub.startDate || !sub.endDate) return null
        const schuif = sleep?.index === index ? sleep.dagen : 0
        const beginDag = dagenTussen(van, sub.startDate) + (sleep?.soort === 'eind' ? 0 : schuif)
        const eindDag = dagenTussen(van, sub.endDate) + (sleep?.soort === 'start' ? 0 : schuif)
        const links = Math.max(0, (beginDag / totaalDagen) * 100)
        const breed = Math.max(1.5, ((eindDag - beginDag + 1) / totaalDagen) * 100)
        return (
          <div key={`${sub.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 120, flexShrink: 0, fontSize: 11.5, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
            <div ref={index === 0 ? baan : undefined}
              style={{ position: 'relative', flex: 1, height: 22, borderRadius: 6, background: 'var(--bg-hover)', overflow: 'hidden' }}>
              {weekenden.map((weekend, i) => (
                <span key={i} aria-hidden style={{ position: 'absolute', top: 0, bottom: 0,
                  left: `${weekend.links}%`, width: `${weekend.breed}%`, background: 'var(--overlay-faint)' }} />
              ))}
              <span role="slider" tabIndex={0}
                aria-label={`Periode van ${sub.name}`}
                aria-valuetext={`${naarNl(sub.startDate)} tot ${naarNl(sub.endDate)}`}
                data-stap-balk={index}
                onPointerDown={event => start(event, index, 'verplaats')}
                onKeyDown={event => {
                  // Met de pijltjes kan het ook; slepen is niet voor
                  // iedereen de handigste manier.
                  const stap = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
                  if (!stap || !sub.startDate || !sub.endDate) return
                  event.preventDefault()
                  const nieuw = event.shiftKey
                    ? rekStap(sub.startDate, sub.endDate, 'eind', stap)
                    : verplaatsStap(sub.startDate, sub.endDate, stap)
                  onChange(subitems.map((entry, i) => i !== index ? entry : {
                    ...entry, startDate: nieuw.startDate, endDate: nieuw.endDate,
                    estHours: Math.round(werkdagenIn(nieuw.startDate, nieuw.endDate) * UREN_PER_DAG * 10) / 10,
                  }))
                }}
                title="Sleep om te verschuiven; pak een rand om korter of langer te maken"
                style={{ position: 'absolute', top: 2, bottom: 2, left: `${links}%`, width: `${breed}%`,
                  background: 'var(--accent)', borderRadius: 5, cursor: 'grab',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span onPointerDown={event => start(event, index, 'start')}
                  style={{ width: 7, alignSelf: 'stretch', cursor: 'ew-resize', borderRadius: '5px 0 0 5px' }} />
                <span onPointerDown={event => start(event, index, 'eind')}
                  style={{ width: 7, alignSelf: 'stretch', cursor: 'ew-resize', borderRadius: '0 5px 5px 0' }} />
              </span>
            </div>
            <span style={{ width: 38, flexShrink: 0, textAlign: 'right', fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {sub.estHours}u
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function ItemPlanner({ boardId, boardName, groups, startGroupId, onCreate, onClose }: {
  boardId: string
  boardName: string
  groups: BoardGroup[]
  /** De groep waar het venster vandaan komt; die staat voorgekozen. */
  startGroupId?: string | null
  /** Zet het item in deze groep op het bord. */
  onCreate: (groupId: string, item: BoardItem) => void
  onClose: () => void
}) {
  const { members } = useTeam()
  const aiAan = useAiPlannerAvailable()
  // Zonder sleutel bestaat het AI-tabblad niet; dan is het sjabloon het
  // hele venster.
  const [tab, setTab] = useState<'sjabloon' | 'ai'>('sjabloon')
  const [prompt, setPrompt] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')
  const [plan, setPlan] = useState<AiItemPlan | null>(null)
  const [groupId, setGroupId] = useState(startGroupId ?? groups[0]?.id ?? '')
  const veld = useRef<HTMLTextAreaElement>(null)

  const [klusNaam, setKlusNaam] = useState('')
  const [sjabloonId, setSjabloonId] = useState(SJABLONEN[0].id)
  const [stappenTekst, setStappenTekst] = useState(() => stappenNaarTekst(SJABLONEN[0].stappen))
  const [deadline, setDeadline] = useState<string | null>(null)
  const [mailOpen, setMailOpen] = useState(false)
  const [mail, setMail] = useState('')
  const [mailUitleg, setMailUitleg] = useState('')

  useEffect(() => { veld.current?.focus() }, [])
  useEffect(() => {
    function opToets(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', opToets)
    return () => window.removeEventListener('keydown', opToets)
  }, [onClose])

  const naamVan = (id: string) => members.find(m => m.id === id)?.name ?? id

  async function vraagVoorstel() {
    const tekst = prompt.trim()
    if (!tekst || bezig) return
    setBezig(true); setFout(''); setPlan(null)
    try {
      // Geen sessie? Dan gaat de aanvraag zonder sleutel de deur uit en
      // antwoordt de server met 401. Beter één duidelijke melding van de
      // server dan hier zelf gaan raden of iemand is ingelogd.
      const sessie = await supabase?.auth.getSession().catch(() => null)
      const token = sessie?.data.session?.access_token
      const res = await fetch('/api/ai/plan', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: tekst,
          context: {
            today: new Date().toISOString().slice(0, 10),
            boardName,
            groupNames: groups.map(groep => groep.name),
            members: members.map(m => ({ id: m.id, name: m.name })),
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error === 'not_configured' ? 'De planner staat uit: er is geen sleutel ingesteld op de server.'
            : res.status === 401 ? 'Log opnieuw in; de server herkende je sessie niet.'
            : 'Er kwam geen bruikbaar voorstel terug. Probeer het nog eens, of schrijf iets concreter op.')
      }
      const voorstel = data.plan as AiItemPlan
      setPlan(voorstel)
      const gekozen = groups.find(groep => groep.name === voorstel.groupName)
      if (gekozen) setGroupId(gekozen.id)
    } catch (error) {
      setFout(error instanceof Error ? error.message : 'Er ging iets mis.')
    } finally {
      setBezig(false)
    }
  }

  function kiesSjabloon(id: string) {
    setSjabloonId(id)
    const sjabloon = SJABLONEN.find(entry => entry.id === id)
    if (sjabloon) setStappenTekst(stappenNaarTekst(sjabloon.stappen))
  }

  /** Een geplakte mail uitpluizen: onderwerp, datum en het lijstje dat
   *  erin staat. Vult de velden hierboven in; wat er niet in stond laat
   *  hij met rust. */
  function leesMail() {
    const uit = mailNaarStappen(mail)
    const gevonden: string[] = []
    if (uit.naam && !klusNaam.trim()) { setKlusNaam(uit.naam); gevonden.push('een naam') }
    if (uit.deadline) { setDeadline(uit.deadline); gevonden.push('een datum') }
    if (uit.stappen.length > 0) {
      setStappenTekst(stappenNaarTekst(uit.stappen))
      gevonden.push(`${uit.stappen.length} stappen`)
    }
    setMailUitleg(gevonden.length > 0
      ? `Uit de mail gehaald: ${gevonden.join(', ')}. Loop het even na.`
      : 'Hier kon ik niets uit halen. Een lijstje met streepjes ervoor leest hij wel.')
    if (gevonden.length > 0) setMailOpen(false)
  }

  function maakSjabloonVoorstel() {
    setFout(''); setPlan(null)
    const uitkomst = planUitSjabloon({
      naam: klusNaam,
      stappen: tekstNaarStappen(stappenTekst),
      deadline: deadline ?? '',
    })
    if (!uitkomst.ok) { setFout(uitkomst.error); return }
    setPlan(uitkomst.plan)
  }

  /** Het item zelf loopt van de eerste tot de laatste stap; sleep je een
   *  stap buiten de periode, dan schuift het item mee. */
  function grenzen(subitems: AiSubitemPlan[]) {
    const datums = subitems.flatMap(sub => [sub.startDate, sub.endDate]).filter((d): d is string => !!d)
    const uren = Math.round(subitems.reduce((som, sub) => som + sub.estHours, 0) * 10) / 10
    if (datums.length === 0) return { estHours: uren }
    return {
      startDate: datums.reduce((a, b) => (a < b ? a : b)),
      endDate: datums.reduce((a, b) => (a > b ? a : b)),
      estHours: uren,
    }
  }

  function maakAan() {
    if (!plan || !groupId) return
    let teller = Date.now()
    const item = planToBoardItem(plan, () => String(teller++))
    onCreate(groupId, item)
    onClose()
  }

  const periode = (start: string | null, eind: string | null) =>
    start || eind ? `${naarNl(start) || '—'} → ${naarNl(eind) || '—'}` : 'geen datum'

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9400 }} />
      <div role="dialog" aria-label="Item aanmaken" style={{
        position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(620px, 94vw)', maxHeight: '84vh', overflowY: 'auto', zIndex: 9401,
        background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.38)', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}><IconSpark size={17} style={{ marginRight: 7, verticalAlign: '-2px', color: 'var(--accent)' }} />Item aanmaken</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>op {boardName}</span>
          <button onClick={onClose} aria-label="Sluiten" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        {/* Alleen een keuze als er iets te kiezen valt. */}
        {aiAan && (
          <div role="tablist" aria-label="Manier van uitschrijven"
            style={{ display: 'flex', gap: 4, margin: '10px 0 12px', padding: 3, borderRadius: 9, background: 'var(--bg-hover)', width: 'fit-content' }}>
            {([['sjabloon', 'Uit een sjabloon'], ['ai', 'Laten uitschrijven']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id}
                onClick={() => { setTab(id); setFout(''); setPlan(null) }}
                style={{ border: 0, borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
                  background: tab === id ? 'var(--bg-card)' : 'transparent',
                  color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.18)' : 'none' }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'sjabloon' ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Kies het soort klus, pas de stappen aan en zeg wanneer het af moet. De werkdagen
              worden teruggeteld vanaf die datum — weekenden slaat hij over.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Naam van de klus
                <input value={klusNaam} onChange={event => setKlusNaam(event.target.value)}
                  aria-label="Naam van de klus" placeholder="NKO Explainer"
                  style={{ ...vak, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Af op
                <div style={{ marginTop: 4 }}>
                  <DatumVeld value={deadline} onChange={setDeadline} ariaLabel="Af op"
                    style={{ ...vak, width: '100%' }} />
                </div>
              </label>
            </div>

            <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Soort klus
              <select value={sjabloonId} onChange={event => kiesSjabloon(event.target.value)} aria-label="Soort klus"
                style={{ ...vak, marginTop: 4 }}>
                {SJABLONEN.map(sjabloon => <option key={sjabloon.id} value={sjabloon.id}>{sjabloon.naam}</option>)}
              </select>
            </label>

            <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Stappen — één per regel, met het aantal werkdagen erachter
              <textarea value={stappenTekst} onChange={event => setStappenTekst(event.target.value)}
                aria-label="Stappen" rows={7}
                style={{ ...vak, marginTop: 4, resize: 'vertical', fontSize: 13.5, lineHeight: 1.5, fontVariantNumeric: 'tabular-nums' }} />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={maakSjabloonVoorstel}
                style={{ border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13,
                  background: 'var(--accent)', color: '#171717', cursor: 'pointer' }}>
                {plan ? 'Opnieuw uitzetten' : 'Zet de stappen uit'}
              </button>
              <button onClick={() => { setMailOpen(open => !open); setMailUitleg('') }}
                aria-expanded={mailOpen}
                style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 12.5,
                  fontWeight: 600, background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Uit een mail halen
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Gratis, geen model — puur werkdagen tellen.</span>
            </div>

            {mailOpen && (
              <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)' }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                  Plak de mail
                  <textarea value={mail} onChange={event => setMail(event.target.value)}
                    aria-label="Plak de mail" rows={6}
                    placeholder={'Onderwerp: Explainer over zonnepanelen\n\nHoi Menno,\n\nWe willen de video uiterlijk 11 december live zetten.\n\n- Script schrijven (2 dagen)\n- Storyboard\n- Animatie maken (5 werkdagen)'}
                    style={{ ...vak, marginTop: 4, resize: 'vertical', fontSize: 13, lineHeight: 1.45 }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <button onClick={leesMail} disabled={!mail.trim()}
                    style={{ border: 0, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
                      background: mail.trim() ? 'var(--accent)' : 'var(--bg-hover)',
                      color: mail.trim() ? '#171717' : 'var(--text-muted)',
                      cursor: mail.trim() ? 'pointer' : 'default' }}>
                    Haal de stappen eruit
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Leest het onderwerp, een datum en het lijstje — meer niet.
                  </span>
                </div>
              </div>
            )}

            {mailUitleg && <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{mailUitleg}</p>}
          </>
        ) : (
          <>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Plak een briefing of vertel in een paar zinnen wat er moet gebeuren. Je krijgt een
          voorstel met subitems, datums en uren — pas als je op Aanmaken klikt komt het op het bord.
        </p>

        <textarea ref={veld} value={prompt} onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void vraagVoorstel() }}
          rows={5} placeholder="Bijvoorbeeld: explainer van 2 minuten voor NKO, aanleveren vrijdag over drie weken. Odette doet storyboard en animatie, Vincent de voice-over."
          style={{ ...vak, resize: 'vertical', fontSize: 13.5, lineHeight: 1.45 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button onClick={() => void vraagVoorstel()} disabled={!prompt.trim() || bezig}
            style={{ border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13,
              background: prompt.trim() && !bezig ? 'var(--accent)' : 'var(--bg-hover)',
              color: prompt.trim() && !bezig ? '#171717' : 'var(--text-muted)',
              cursor: prompt.trim() && !bezig ? 'pointer' : 'default' }}>
            {bezig ? 'Bezig…' : plan ? 'Opnieuw voorstellen' : 'Maak een voorstel'}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>⌘/Ctrl + Enter</span>
        </div>
          </>
        )}

        {fout && <p role="alert" style={{ marginTop: 12, marginBottom: 0, fontSize: 12.5, color: 'var(--red, #e2445c)' }}>{fout}</p>}

        {plan && (
          <div data-ai-voorstel style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15.5, color: 'var(--text-primary)' }}>{plan.name}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{periode(plan.startDate, plan.endDate)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {plan.estHours}u</span>
            </div>
            {plan.ownerIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {plan.ownerIds.map(id => (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <UserAvatar memberId={id} size={20} />{naamVan(id)}
                  </span>
                ))}
              </div>
            )}
            {plan.notes && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{plan.notes}</p>}

            {plan.subitems.length > 0 && (
              <>
                <VoorstelTijdlijn subitems={plan.subitems}
                  onChange={subitems => setPlan(huidig => huidig && { ...huidig, subitems, ...grenzen(subitems) })} />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  Sleep een balkje om het te verschuiven, of pak een rand om het korter of langer
                  te maken. De uren lopen mee.
                </p>
              </>
            )}

            {plan.subitems.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {plan.subitems.map((sub, index) => (
                  <li key={`${sub.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
                    padding: '7px 9px', borderRadius: 8, background: 'var(--bg-hover)' }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)' }}>{sub.name}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{periode(sub.startDate, sub.endDate)}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sub.estHours}u</span>
                    {sub.ownerIds.map(id => <UserAvatar key={id} memberId={id} size={18} />)}
                    <button onClick={() => setPlan(huidig => {
                        if (!huidig) return huidig
                        const subitems = huidig.subitems.filter((_, i) => i !== index)
                        return { ...huidig, subitems, ...grenzen(subitems) }
                      })}
                      title="Dit subitem weglaten" aria-label={`${sub.name} weglaten`}
                      style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Groep
                <select value={groupId} onChange={event => setGroupId(event.target.value)} aria-label="Groep"
                  style={{ ...vak, width: 'auto', padding: '6px 8px' }}>
                  {groups.map(groep => <option key={groep.id} value={groep.id}>{groep.name}</option>)}
                </select>
              </label>
              <button onClick={maakAan} disabled={!groupId} data-ai-aanmaken
                style={{ marginLeft: 'auto', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13,
                  background: groupId ? 'var(--accent)' : 'var(--bg-hover)', color: groupId ? '#171717' : 'var(--text-muted)',
                  cursor: groupId ? 'pointer' : 'default' }}>
                Aanmaken
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
              Een voorstel, geen waarheid: loop de datums en uren even na voor je het aanmaakt.
              Alles is daarna gewoon aan te passen op {boardId}.
            </p>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
