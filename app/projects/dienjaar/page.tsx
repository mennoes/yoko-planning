'use client'
import { useState, useEffect, useRef } from 'react'
import BoardTable from '@/components/BoardTable'
import { BOARD_CONFIGS, type BoardGroup } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useBoardTitle } from '@/lib/useBoardTitle'
import initialData from '@/data/boards/dienjaar.json'

export default function DienjaarPage() {
  const [groups, setGroups] = useState<BoardGroup[]>(initialData.groups as BoardGroup[])
  const loadedRef = useRef(false)
  const cfg = BOARD_CONFIGS['dienjaar']
  const { title, renameTitle } = useBoardTitle('dienjaar', cfg.name)

  useEffect(() => {
    setGroups(loadGroups('dienjaar', initialData.groups as BoardGroup[]))
    function onUpdate(e: Event) {
      const ce = e as CustomEvent<{ boardName: string }>
      if (!ce.detail || ce.detail.boardName === 'dienjaar') setGroups(loadGroups('dienjaar', initialData.groups as BoardGroup[]))
    }
    window.addEventListener('yoko-board-update', onUpdate)
    return () => window.removeEventListener('yoko-board-update', onUpdate)
  }, [])

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return }
    saveGroups('dienjaar', groups)
  }, [groups])

  return <BoardTable boardId="dienjaar" title={title} emoji={cfg.emoji} color={cfg.color} columns={cfg.columns} groups={groups} onChange={setGroups} onRenameTitle={renameTitle} />
}
