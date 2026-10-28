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
import { planToBoardItem, type AiItemPlan } from '@/lib/aiPlan'
import { planUitSjabloon, stappenNaarTekst, tekstNaarStappen, SJABLONEN } from '@/lib/sjabloonPlan'
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

export function ItemPlanner({ boardId, boardName, groups, onCreate, onClose }: {
  boardId: string
  boardName: string
  groups: BoardGroup[]
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
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const veld = useRef<HTMLTextAreaElement>(null)

  const [klusNaam, setKlusNaam] = useState('')
  const [sjabloonId, setSjabloonId] = useState(SJABLONEN[0].id)
  const [stappenTekst, setStappenTekst] = useState(() => stappenNaarTekst(SJABLONEN[0].stappen))
  const [deadline, setDeadline] = useState<string | null>(null)

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
      <div role="dialog" aria-label="Klus uitzetten" style={{
        position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(620px, 94vw)', maxHeight: '84vh', overflowY: 'auto', zIndex: 9401,
        background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.38)', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>Klus uitzetten</h2>
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button onClick={maakSjabloonVoorstel}
                style={{ border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13,
                  background: 'var(--accent)', color: '#171717', cursor: 'pointer' }}>
                {plan ? 'Opnieuw uitzetten' : 'Zet de stappen uit'}
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Gratis, geen model — puur werkdagen tellen.</span>
            </div>
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
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {plan.subitems.map((sub, index) => (
                  <li key={`${sub.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
                    padding: '7px 9px', borderRadius: 8, background: 'var(--bg-hover)' }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)' }}>{sub.name}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{periode(sub.startDate, sub.endDate)}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sub.estHours}u</span>
                    {sub.ownerIds.map(id => <UserAvatar key={id} memberId={id} size={18} />)}
                    <button onClick={() => setPlan({ ...plan, subitems: plan.subitems.filter((_, i) => i !== index) })}
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
