'use client'

// DEMO-VARIANT van app/projects/[slug]/page.tsx — hergebruikt dezelfde
// (al demo-veilige) BoardTable-component en boardsRegistry, met als
// enige verschil de seed-fallback: de echte pagina start een onbekend
// bord leeg, hier vullen we 'm met de verzonnen demo-inhoud zodat
// 'Agenda's → Noorderlicht Media' meteen gevuld oogt bij een eerste
// bezoek (loadGroups schrijft de fallback niet weg, dus elke call-site
// moet 'm zelf meegeven).
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import BoardTable from '@/components/BoardTable'
import type { BoardGroup, BoardConfig } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useBoardTitle } from '@/lib/useBoardTitle'
import { getBoardConfig, onBoardsRegistryUpdate } from '@/lib/boardsRegistry'
import { buildDemoBoards } from '@/lib/demoFixtures'

export default function DynamicBoardPage() {
  const params = useParams()
  // Next decodeert dynamische segmenten hier niet automatisch (bord-ids
  // met een spatie zoals 'Noorderlicht Media' komen als %20 binnen) —
  // decoden we zelf, defensief tegen een dubbele encode.
  const rawSlug = String(params.slug ?? '')
  const slug = (() => { try { return decodeURIComponent(rawSlug) } catch { return rawSlug } })()
  const [cfg, setCfg] = useState<BoardConfig | null>(() => getBoardConfig(slug))
  useEffect(() => {
    setCfg(getBoardConfig(slug))
    return onBoardsRegistryUpdate(() => setCfg(getBoardConfig(slug)))
  }, [slug])

  const { title, renameTitle } = useBoardTitle(slug, cfg?.name ?? slug)
  const [groups, setGroups] = useState<BoardGroup[]>([])

  useEffect(() => {
    const seed = buildDemoBoards()[slug]?.groups ?? []
    setGroups(loadGroups(slug, seed))
    function onUpdate(e: Event) {
      const ce = e as CustomEvent<{ boardName: string }>
      if (!ce.detail || ce.detail.boardName === slug) {
        setGroups(loadGroups(slug, seed))
      }
    }
    window.addEventListener('yoko-board-update', onUpdate)
    return () => window.removeEventListener('yoko-board-update', onUpdate)
  }, [slug])

  // Direct opslaan bij een echte wijziging (BoardTable's onChange) i.p.v.
  // een reactief 'sla groups op zodra ze veranderen, behalve de eerste
  // keer'-effect — dat laatste race't met de asynchrone seed-load hierboven
  // (de save-effect kan al eens 'geweest' zijn vóórdat de seed-state écht
  // gecommit is, en overschrijft 'm dan met een lege array).
  function handleChange(next: BoardGroup[]) {
    setGroups(next)
    saveGroups(slug, next)
  }

  if (!cfg) {
    return (
      <div style={{ maxWidth: 800, padding: '64px 36px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>Bord niet gevonden</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Het bord <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4 }}>{slug}</code> bestaat (nog) niet.
          Voeg 'm aan via de + bij Agenda's in de sidebar.
        </p>
      </div>
    )
  }

  return <BoardTable boardId={slug} title={title} emoji={cfg.emoji} color={cfg.color}
    columns={cfg.columns} groups={groups} onChange={handleChange} onRenameTitle={renameTitle} />
}
