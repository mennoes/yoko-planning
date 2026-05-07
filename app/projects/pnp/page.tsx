'use client'
import { useState, useEffect, useRef } from 'react'
import BoardTable from '@/components/BoardTable'
import { BOARD_CONFIGS, type BoardGroup } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useBoardTitle } from '@/lib/useBoardTitle'
import initialData from '@/data/boards/pnp.json'

export default function PnpPage() {
  const [groups, setGroups] = useState<BoardGroup[]>(initialData.groups as BoardGroup[])
  const loadedRef = useRef(false)
  const cfg = BOARD_CONFIGS['pnp']
  const { title, renameTitle } = useBoardTitle('pnp', cfg.name)

  useEffect(() => {
    setGroups(loadGroups('pnp', initialData.groups as BoardGroup[]))
    function onUpdate(e: Event) {
      const ce = e as CustomEvent<{ boardName: string }>
      if (!ce.detail || ce.detail.boardName === 'pnp') setGroups(loadGroups('pnp', initialData.groups as BoardGroup[]))
    }
    window.addEventListener('yoko-board-update', onUpdate)
    return () => window.removeEventListener('yoko-board-update', onUpdate)
  }, [])

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return }
    saveGroups('pnp', groups)
  }, [groups])

  return <BoardTable title={title} emoji={cfg.emoji} color={cfg.color} columns={cfg.columns} groups={groups} onChange={setGroups} onRenameTitle={renameTitle} />
}
