import type { QueueTicketTeam } from '@/hooks/useJiraIssue';

export const ALL_TEAMS = 'all';
export const NO_TEAM = 'none';

export function teamFilterKey(team: string | null): string {
  return team ? `team:${team}` : NO_TEAM;
}

export function matchesTeamFilter(ticket: QueueTicketTeam | undefined, filter: string): boolean {
  if (filter === ALL_TEAMS) return true;
  if (!ticket?.isJira || ticket.isLoading) return false;
  if (filter === NO_TEAM) return !ticket.team;
  const name = filter.startsWith('team:') ? filter.slice('team:'.length) : filter;
  return ticket.team === name;
}

export function indicesForTeam(tickets: QueueTicketTeam[], filter: string): number[] {
  return tickets
    .map((ticket, index) => (matchesTeamFilter(ticket, filter) ? index : -1))
    .filter((index) => index >= 0);
}
