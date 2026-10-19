'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  loadCustomTeamGroups, loadTeamSections, pullTeamGroups, subscribeRemoteTeamGroups, onTeamGroupsChange,
  createTeamGroup, assignMemberToTeamGroup, moveTeamGroup, canMoveTeamGroup, type TeamGroup,
} from '@/lib/teamGroups'

export function useTeamGroups() {
  // `groups` zijn alleen je eigen teams — die kun je leden toewijzen.
  // `sections` is de volledige volgorde inclusief Studio Yoko, Freelancers
  // en Inactief team; daar hoort geen handmatige ledenlijst bij.
  const [groups, setGroups] = useState<TeamGroup[]>(() => loadCustomTeamGroups())
  const [sections, setSections] = useState<TeamGroup[]>(() => loadTeamSections())
  const refresh = useCallback(() => {
    setGroups(loadCustomTeamGroups())
    setSections(loadTeamSections())
  }, [])

  useEffect(() => {
    refresh()
    void pullTeamGroups().then(refresh)
    const offLocal = onTeamGroupsChange(refresh)
    const offRemote = subscribeRemoteTeamGroups()
    return () => { offLocal(); offRemote() }
  }, [refresh])

  return {
    groups,
    sections,
    createGroup: createTeamGroup,
    assignMember: assignMemberToTeamGroup,
    moveGroup: moveTeamGroup,
    canMoveGroup: canMoveTeamGroup,
  }
}
