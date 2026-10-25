'use client'

// Welke freelancers draaien er mee?
//
// De planning rekende dit zelf uit, omdat daar de agenda's toch al in het
// geheugen zitten. De teampagina heeft dezelfde vraag maar laadt geen
// borden, dus die haalt ze hier op: eerst uit de cache zodat er direct
// iets staat, daarna vers uit Supabase.
//
// `geladen` is er om een verkeerde eerste indruk te voorkomen. Zonder
// agenda's heeft niemand werk en zou élke freelancer onder 'Inactief
// team' springen, om een seconde later weer terug te verhuizen. Tot het
// antwoord er is laat je de indeling dus met rust.

import { useEffect, useMemo, useState } from 'react'
import { loadGroups, pullBoardFromRemote } from '@/lib/boardStore'
import { getBoardIds } from '@/lib/boardsRegistry'
import { groupsToProjects, type Project } from '@/lib/workload'
import type { BoardGroup } from '@/lib/boards'
import { membersWithWorkInWindow, FREELANCER_ACTIVE_DAYS } from '@/lib/freelancerActivity'

function alleProjecten(): Project[] {
  const boardIds = getBoardIds()
  return boardIds.flatMap(boardId => groupsToProjects(boardId, loadGroups(boardId, [] as BoardGroup[])))
}

export function useActiveFreelancers(): { activeIds: Set<string>; geladen: boolean } {
  const [projecten, setProjecten] = useState<Project[]>([])
  const [geladen, setGeladen] = useState(false)

  useEffect(() => {
    const lees = () => {
      const next = alleProjecten()
      setProjecten(next)
      // Een leeg bordenlijstje betekent 'nog niets binnen', geen
      // 'niemand werkt'. Pas als er iets staat is het antwoord bruikbaar.
      if (next.length > 0) setGeladen(true)
    }
    lees()
    // De agenda's zijn de bron van waarheid; de cache kan van gisteren
    // zijn. Na de pull nog één keer lezen, en dan is het antwoord er —
    // ook wanneer er echt geen werk gepland staat.
    void Promise.all(getBoardIds().map(boardId => pullBoardFromRemote(boardId).catch(() => false)))
      .then(() => { lees(); setGeladen(true) })
      .catch(() => setGeladen(true))

    const opBordWijziging = () => lees()
    window.addEventListener('yoko-board-update', opBordWijziging)
    return () => window.removeEventListener('yoko-board-update', opBordWijziging)
  }, [])

  const activeIds = useMemo(
    () => membersWithWorkInWindow(projecten, {
      backDays: FREELANCER_ACTIVE_DAYS,
      forwardDays: FREELANCER_ACTIVE_DAYS,
    }),
    [projecten],
  )

  return { activeIds, geladen }
}
