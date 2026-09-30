'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  loadTeamGroups, pullTeamGroups, subscribeRemoteTeamGroups, onTeamGroupsChange,
  createTeamGroup, assignMemberToTeamGroup, moveTeamGroup, type TeamGroup,
} from '@/lib/teamGroups'

export function useTeamGroups() {
  const [groups, setGroups] = useState<TeamGroup[]>(() => loadTeamGroups())
  const refresh = useCallback(() => setGroups(loadTeamGroups()), [])

  useEffect(() => {
    refresh()
    void pullTeamGroups().then(refresh)
    const offLocal = onTeamGroupsChange(refresh)
    const offRemote = subscribeRemoteTeamGroups()
    return () => { offLocal(); offRemote() }
  }, [refresh])

  return {
    groups,
    createGroup: createTeamGroup,
    assignMember: assignMemberToTeamGroup,
    moveGroup: moveTeamGroup,
  }
}
