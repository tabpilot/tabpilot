import { useEffect, useMemo, useRef, useState } from 'react';
import { useJiraIssueTeams } from '@/hooks/useJiraIssue';
import { ALL_TEAMS, indicesForTeam, NO_TEAM, teamFilterKey } from '@/lib/teamQueue';

interface UseTeamQueuesOptions {
  readonly urls: string[];
  readonly currentIndex: number;
  readonly enabled: boolean;
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
  onJumpToIndex,
}: UseTeamQueuesOptions) {
  const ticketTeams = useJiraIssueTeams(urls);
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const positions = useRef<Record<string, number>>({});
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
    positions.current[currentTeamKey] = currentIndex;
    setTeamFilter((current) => {
      // Keep a queue the host just opened until the shared ticket moves into it.
      if (current !== ALL_TEAMS && current !== currentTeamKey) return current;
      return currentTeamKey;
    });
  }, [enabled, currentIndex, currentTeamKey]);

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
    const saved = positions.current[next];
    const target = saved !== undefined && indices.includes(saved) ? saved : indices[0];
    setTeamFilter(next);
    if (target !== undefined && target !== currentIndex) onJumpToIndex(target);
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

  function nextIncompleteTeam(savedVotes: Record<number, string>): string | null {
    if (!enabled) return null;
    const allKeys = [...teams.map((t) => `team:${t}`), ...(hasUnassigned ? [NO_TEAM] : [])];
    const otherKeys = allKeys.filter((k) => k !== teamFilter);
    const currentFirst = [teamFilter, ...otherKeys];
    for (const key of currentFirst) {
      const indices = indicesForTeam(ticketTeams, key);
      // Past tickets (< currentIndex) are already groomed; only future/current without a vote are pending
      const hasPending = indices.some((i) => i >= currentIndex && savedVotes[i] === undefined);
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
    teams,
    hasUnassigned,
    nextIncompleteTeam,
    indicesForTeam: (key: string) => indicesForTeam(ticketTeams, key),
  };
}
