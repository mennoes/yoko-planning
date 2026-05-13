'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import BoardTable from '@/components/BoardTable'
import type { BoardGroup, BoardConfig } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useBoardTitle } from '@/lib/useBoardTitle'
import { getBoardConfig, onBoardsRegistryUpdate } from '@/lib/boardsRegistry'

/**
 * Dynamische bord-pagina. Werkt voor elke `id` die in de boards-registry
 * staat (Supabase + localStorage fallback). Ingebouwde 5 borden (yoko,
 * pnp, etc.) werken hier ook door — hun config zit in de fallback van
 * de registry.
 */
export default function DynamicBoardPage() {
  const params = useParams()
  const slug   = String(params.slug ?? '')
  const [cfg, setCfg] = useState<BoardConfig | null>(() => getBoardConfig(slug))
  useEffect(() => {
    setCfg(getBoardConfig(slug))
    return onBoardsRegistryUpdate(() => setCfg(getBoardConfig(slug)))
  }, [slug])

  const { title, renameTitle } = useBoardTitle(slug, cfg?.name ?? slug)
  const [groups, setGroups] = useState<BoardGroup[]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    setGroups(loadGroups(slug, []))
    function onUpdate(e: Event) {
      const ce = e as CustomEvent<{ boardName: string }>
      if (!ce.detail || ce.detail.boardName === slug) {
        setGroups(loadGroups(slug, []))
      }
    }
    window.addEventListener('yoko-board-update', onUpdate)
    return () => window.removeEventListener('yoko-board-update', onUpdate)
  }, [slug])

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return }
    saveGroups(slug, groups)
  }, [groups, slug])

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
    columns={cfg.columns} groups={groups} onChange={setGroups} onRenameTitle={renameTitle} />
}
