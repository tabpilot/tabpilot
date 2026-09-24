import { useEffect, useMemo, useState } from 'react';
import { useJiraIssueTeams } from '@/hooks/useJiraIssue';
import { ALL_TEAMS, indicesForTeam, NO_TEAM, teamFilterKey } from '@/lib/teamQueue';

interface UseTeamQueuesOptions {
  readonly urls: string[];
  readonly currentIndex: number;
  readonly enabled: boolean;
  readonly teamQueueProgress: Record<string, number>;
  readonly onJumpToIndex: (index: number) => void;
}

/**
 * Team filter for the host queue.
 * When team queues are on, each team keeps its own place in the list and
 * choosing a team jumps to that place. When they are off, a team tab only
 * filters the list.
 */
export function useTeamQueues({
  urls,
  currentIndex,
  enabled,
  teamQueueProgress,
  onJumpToIndex,
}: UseTeamQueuesOptions) {
  const ticketTeams = useJiraIssueTeams(urls);
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const currentTicket = ticketTeams[currentIndex];
  const currentTeamKey =
    currentTicket && !currentTicket.isLoading && currentTicket.isJira
      ? teamFilterKey(currentTicket.team)
      : null;

  useEffect(() => {
    if (!enabled) {
      setTeamFilter(ALL_TEAMS);
      return;
    }
    if (!currentTeamKey) return;
    setTeamFilter((current) => {
      // Keep a queue the host just opened until the shared ticket moves into it.
      if (current !== ALL_TEAMS && current !== currentTeamKey) return current;
      return currentTeamKey;
    });
  }, [enabled, currentTeamKey]);

  const queueIndices = useMemo(
    () => (enabled ? indicesForTeam(ticketTeams, teamFilter) : urls.map((_, index) => index)),
    [enabled, ticketTeams, teamFilter, urls],
  );

  function selectTeam(next: string) {
    if (!enabled) {
      setTeamFilter(next);
      return;
    }
    const indices = indicesForTeam(ticketTeams, next);
    const progress = progressPosition(next, indices);
    const target = indices[Math.min(progress, Math.max(indices.length - 1, 0))];
    setTeamFilter(next);
    if (target !== undefined && target !== currentIndex) onJumpToIndex(target);
  }

  function progressPosition(key: string, indices = indicesForTeam(ticketTeams, key)): number {
    const stored = teamQueueProgress[key];
    if (stored !== undefined) return Math.max(0, Math.min(stored, indices.length));
    // Older sessions only have the shared global pointer. Preserve their existing
    // progression as the baseline until a team-specific cursor is written.
    return key === currentTeamKey ? indices.filter((index) => index < currentIndex).length : 0;
  }

  function progressUpdate(position: number) {
    return { queueKey: teamFilter, position };
  }

  function step(offset: number): number | null {
    const position = queueIndices.indexOf(currentIndex);
    if (position < 0) return null;
    const target = queueIndices[position + offset];
    return target === undefined ? null : target;
  }

  const teams = useMemo(() => {
    const names = new Set<string>();
    for (const ticket of ticketTeams) {
      if (ticket.team) names.add(ticket.team);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [ticketTeams]);

  const hasUnassigned = ticketTeams.some(
    (ticket) => ticket.isJira && !ticket.isLoading && !ticket.team,
  );

  function nextIncompleteTeam(
    progressOverrides: Record<string, number> = teamQueueProgress,
  ): string | null {
    if (!enabled) return null;
    const allKeys = [...teams.map((t) => `team:${t}`), ...(hasUnassigned ? [NO_TEAM] : [])];
    const otherKeys = allKeys.filter((k) => k !== teamFilter);
    const currentFirst = [teamFilter, ...otherKeys];
    for (const key of currentFirst) {
      const indices = indicesForTeam(ticketTeams, key);
      const position =
        progressOverrides[key] ??
        (key === currentTeamKey ? indices.filter((index) => index < currentIndex).length : 0);
      const hasPending = position < indices.length;
      if (indices.length > 0 && hasPending) return key;
    }
    return null;
  }

  return {
    teamFilter,
    selectTeam,
    filterLocksNavigation: !enabled && teamFilter !== ALL_TEAMS,
    queueIndices,
    queuePosition: queueIndices.indexOf(currentIndex),
    step,
    progressPosition,
    progressUpdate,
    teams,
    hasUnassigned,
    nextIncompleteTeam,
    indicesForTeam: (key: string) => indicesForTeam(ticketTeams, key),
  };
}
