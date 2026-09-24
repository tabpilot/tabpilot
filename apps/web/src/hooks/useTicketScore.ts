import type { TicketScore } from '@tabpilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { parseJiraUrl } from '@/lib/jira';

async function fetchTicketScore(key: string, baseUrl?: string): Promise<TicketScore> {
  const params = baseUrl ? { baseUrl } : undefined;
  const res = await apiClient.get<TicketScore>(`/ticket-score/${key}`, { params });
  return res.data;
}

async function fetchTicketScoreByUrl(url: string): Promise<TicketScore> {
  const res = await apiClient.get<TicketScore>('/ticket-score/url', { params: { url } });
  return res.data;
}

function is429(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 429;
}

/**
 * Fetch the AI quality score for the active ticket.
 * Only called for the current ticket — scores are generated on navigation, not upfront.
 */
export function useTicketScore(url: string) {
  const info = parseJiraUrl(url);

  return useQuery({
    queryKey: info ? ['ticket-score', info.key] : ['ticket-score', 'url', url],
    queryFn: info
      ? () => fetchTicketScore(info.key, info.baseUrl)
      : () => fetchTicketScoreByUrl(url),
    enabled: !!url,
    staleTime: Infinity,
    retry: (count, err) => count < 3 && is429(err),
    retryDelay: (attempt) => (attempt + 1) * 2000,
    throwOnError: false,
  });
}

/**
 * Read a cached ticket score without triggering a fetch.
 * Used in queue-row badges — only shows scores for already-visited tickets.
 */
export function useCachedTicketScore(url: string): TicketScore | undefined {
  const qc = useQueryClient();
  const info = parseJiraUrl(url);
  const queryKey = info ? ['ticket-score', info.key] : ['ticket-score', 'url', url];
  return qc.getQueryData<TicketScore>(queryKey);
}

/** No-op: scores are pushed via TICKET_SCORE_UPDATE WebSocket event into React Query cache. */
export function usePrefetchTicketScores(_urls: string[]) {}
