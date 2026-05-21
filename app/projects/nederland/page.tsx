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
    function onUpdate(e: Event) {
      const ce = e as CustomEvent<{ boardName: string }>
      if (!ce.detail || ce.detail.boardName === 'nederland') setGroups(loadGroups('nederland', initialData.groups as BoardGroup[]))
    }
    window.addEventListener('yoko-board-update', onUpdate)
    return () => window.removeEventListener('yoko-board-update', onUpdate)
  }, [])

  // Eenmalige migratie: items uit de seed-JSON die nog niet op het Nederland-
  // bord voorkomen (case-insensitive op naam) inserten in de eerste groep.
  // Idempotent — zodra ze bestaan doet de check niets meer. Gate via
  // localStorage zodat we 'm hooguit één keer per device proberen ook al
  // schopt de gebruiker een item later weer weg.
  useEffect(() => {
    if (!loadedRef.current) return
    if (typeof window === 'undefined') return
    const MIG_KEY = 'yoko-nederland-uvnl-s04-seed-v1'
    if (localStorage.getItem(MIG_KEY) === '1') return
    if (groups.length === 0) return
    const seedItems = (initialData.groups[0]?.items ?? []) as BoardGroup['items']
    const targetGroupIdx = 0
    const targetGroup = groups[targetGroupIdx]
    if (!targetGroup) { localStorage.setItem(MIG_KEY, '1'); return }
    const allNames = new Set(
      groups.flatMap(g => g.items.map(i => (i.name ?? '').trim().toLowerCase()))
    )
    const missing = seedItems.filter(i => !allNames.has((i.name ?? '').trim().toLowerCase()))
    if (missing.length === 0) { localStorage.setItem(MIG_KEY, '1'); return }
    const next = groups.map((g, gi) =>
      gi === targetGroupIdx ? { ...g, items: [...g.items, ...missing] } : g
    )
    setGroups(next)
    localStorage.setItem(MIG_KEY, '1')
  }, [groups])

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return }
    saveGroups('nederland', groups)
  }, [groups])

  return <BoardTable boardId="nederland" title={title} emoji={cfg.emoji} color={cfg.color} columns={cfg.columns} groups={groups} onChange={setGroups} onRenameTitle={renameTitle} />
}
