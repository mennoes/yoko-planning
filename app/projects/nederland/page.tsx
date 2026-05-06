'use client'
import { useState, useEffect, useRef } from 'react'
import BoardTable from '@/components/BoardTable'
import { BOARD_CONFIGS, type BoardGroup } from '@/lib/boards'
import { loadGroups, saveGroups } from '@/lib/boardStore'
import { useBoardTitle } from '@/lib/useBoardTitle'
import initialData from '@/data/boards/nederland.json'

export default function NederlandPage() {
  const [groups, setGroups] = useState<BoardGroup[]>(initialData.groups as BoardGroup[])
  const loadedRef = useRef(false)
  const cfg = BOARD_CONFIGS['nederland']
  const { title, renameTitle } = useBoardTitle('nederland', cfg.name)

  useEffect(() => {
    setGroups(loadGroups('nederland', initialData.groups as BoardGroup[]))
  }, [])

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return }
    saveGroups('nederland', groups)
  }, [groups])

  return <BoardTable title={title} emoji={cfg.emoji} color={cfg.color} columns={cfg.columns} groups={groups} onChange={setGroups} onRenameTitle={renameTitle} />
}
