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
import { PlanTimeline } from './PlanTimeline'
import { planToBoardItem, type AiItemPlan } from '@/lib/aiPlan'
import {
  planUitSjabloon, stappenNaarTekst, tekstNaarStappen, SJABLONEN,
  UREN_PER_DAG, werkdagenIn,
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

export function ItemPlanner({ boardName, groups, startGroupId, onCreate, onClose }: {
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
  const [mailBezig, setMailBezig] = useState(false)

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
  /** Zet een uitkomst in de velden en vertel wat er gevonden is. */
  function vulVelden(uit: { naam: string | null; deadline: string | null; stappen: Array<{ naam: string; dagen: number }> }, hoe: string, extra = '') {
    const gevonden: string[] = []
    if (uit.naam && !klusNaam.trim()) { setKlusNaam(uit.naam); gevonden.push('een naam') }
    if (uit.deadline) { setDeadline(uit.deadline); gevonden.push('een datum') }
    if (uit.stappen.length > 0) {
      setStappenTekst(stappenNaarTekst(uit.stappen))
      gevonden.push(`${uit.stappen.length} stappen`)
    }
    setMailUitleg(gevonden.length > 0
      ? `${hoe}: ${gevonden.join(', ')}.${extra} Loop het even na.`
      : 'Hier kon ik niets uit halen. Zet de stappen er zelf in, of plak een mail met een lijstje.')
    if (gevonden.length > 0) setMailOpen(false)
    return gevonden.length > 0
  }

  /**
   * De mail uitpluizen.
   *
   * Staat er een sleutel op de server, dan leest het model de mail —
   * dat snapt lopende tekst. Lukt dat niet (geen sleutel, geen
   * verbinding, geen bruikbaar antwoord), dan doen de regels in
   * lib/mailNaarStappen het werk, en zeggen we welke van de twee het
   * was.
   */
  async function leesMail() {
    if (!mail.trim() || mailBezig) return
    setMailBezig(true); setMailUitleg('')
    try {
      if (aiAan) {
        const gelukt = await leesMailMetModel()
        if (gelukt) return
      }
      const uit = mailNaarStappen(mail, { leden: members.map(lid => ({ name: lid.name })) })
      const namen = uit.ownerNamen.length > 0 ? ` Genoemd: ${uit.ownerNamen.join(', ')}.` : ''
      const zoals = uit.bron === 'sjabloon'
        ? 'Geen stappen gevonden, maar dit lijkt op een bekend soort klus — als beginpunt'
        : 'Uit de mail gelezen'
      vulVelden(uit, zoals, namen)
    } finally {
      setMailBezig(false)
    }
  }

  /** De mail door het model laten lezen. Geeft terug of dat iets
   *  opleverde; zo niet, dan nemen de regels het over. */
  async function leesMailMetModel(): Promise<boolean> {
    try {
      const sessie = await supabase?.auth.getSession().catch(() => null)
      const token = sessie?.data.session?.access_token
      const res = await fetch('/api/ai/plan', {
        method: 'POST',
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Hieronder staat een mail. Maak er een planning van.\n\n${mail}`,
          context: {
            today: new Date().toISOString().slice(0, 10),
            boardName,
            groupNames: groups.map(groep => groep.name),
            members: members.map(m => ({ id: m.id, name: m.name })),
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return false
      const voorstel = data.plan as AiItemPlan
      // Het model levert datums per stap; hier hebben we werkdagen
      // nodig, want de velden hierboven rekenen terug vanaf de deadline.
      const stappen = voorstel.subitems.map(sub => ({
        naam: sub.name,
        dagen: Math.max(1, Math.round((sub.estHours || UREN_PER_DAG) / UREN_PER_DAG)),
      }))
      return vulVelden(
        { naam: voorstel.name, deadline: voorstel.endDate, stappen },
        'Het model las de mail',
        voorstel.ownerIds.length > 0
          ? ` Genoemd: ${voorstel.ownerIds.map(id => naamVan(id)).join(', ')}.`
          : '')
    } catch {
      return false
    }
  }

  function maakSjabloonVoorstel() {
    setFout(''); setPlan(null)
    const uitkomst = planUitSjabloon({
      naam: klusNaam,
      stappen: tekstNaarStappen(stappenTekst),
      deadline: deadline ?? '',
    })
    if (!uitkomst.ok) { setFout(uitkomst.error); return }
    setPlan({ ...uitkomst.plan, ownerIds: plan?.ownerIds ?? [], subitems: uitkomst.plan.subitems.map(sub => ({
      ...sub, ownerIds: plan?.subitems.find(previous => previous.name === sub.name)?.ownerIds ?? [],
    })) })
  }

  function maakAan() {
    if (!plan || !groupId) return
    let teller = Date.now()
    const item = { ...planToBoardItem(plan, () => String(teller++)), deadline }
    onCreate(groupId, item)
    onClose()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9400 }} />
      <div role="dialog" aria-label="Item aanmaken" style={{
        position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(900px, 94vw)', boxSizing: 'border-box', maxHeight: '84vh', overflowY: 'auto', zIndex: 9401,
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Naam
                <input value={klusNaam} onChange={event => { setKlusNaam(event.target.value); setPlan(current => current && { ...current, name: event.target.value }) }}
                  aria-label="Naam van de klus" placeholder="NKO Explainer"
                  style={{ ...vak, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Deadline
                <div style={{ marginTop: 4 }}>
                  <DatumVeld value={deadline} onChange={setDeadline} ariaLabel="Deadline"
                    style={{ ...vak, width: '100%' }} />
                </div>
              </label>
            </div>

            <details open={!plan} style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>Sjabloon & stappen</summary>
            <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Soort klus
              <select value={sjabloonId} onChange={event => kiesSjabloon(event.target.value)} aria-label="Soort klus"
                style={{ ...vak, marginTop: 4 }}>
                {SJABLONEN.map(sjabloon => <option key={sjabloon.id} value={sjabloon.id}>{sjabloon.naam}</option>)}
              </select>
            </label>

            <label style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Stappen
              <textarea value={stappenTekst} onChange={event => setStappenTekst(event.target.value)}
                aria-label="Stappen" rows={4}
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
            </div>

            </details>

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
                  <button onClick={() => void leesMail()} disabled={!mail.trim() || mailBezig}
                    style={{ border: 0, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
                      background: mail.trim() && !mailBezig ? 'var(--accent)' : 'var(--bg-hover)',
                      color: mail.trim() && !mailBezig ? '#171717' : 'var(--text-muted)',
                      cursor: mail.trim() && !mailBezig ? 'pointer' : 'default' }}>
                    {mailBezig ? 'Bezig…' : 'Haal de stappen eruit'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {aiAan
                      ? 'Het model leest de mail; lukt dat niet, dan zoekt hij zelf naar een lijstje en een datum.'
                      : 'Zoekt het onderwerp, een datum en de stappen — een lijstje, een opsomming of regels met een werkwoord.'}
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
            <PlanTimeline plan={plan} onChange={next => {
              setPlan(next); setKlusNaam(next.name)
              setStappenTekst(stappenNaarTekst(next.subitems.map(sub => ({ naam: sub.name, dagen: sub.startDate && sub.endDate ? werkdagenIn(sub.startDate, sub.endDate) : Math.max(1, sub.estHours / UREN_PER_DAG) }))))
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Groep
                <select value={groupId} onChange={event => setGroupId(event.target.value)} aria-label="Groep"
                  style={{ ...vak, width: 'auto', padding: '6px 8px' }}>
                  {groups.map(groep => <option key={groep.id} value={groep.id}>{groep.name}</option>)}
                </select>
              </label>
              <button onClick={maakAan} disabled={!groupId || !plan.name.trim() || plan.subitems.some(s => !s.name.trim())} data-ai-aanmaken
                style={{ marginLeft: 'auto', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13,
                  background: groupId ? 'var(--accent)' : 'var(--bg-hover)', color: groupId ? '#171717' : 'var(--text-muted)',
                  cursor: groupId ? 'pointer' : 'default' }}>
                Aanmaken
              </button>
            </div>

          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
