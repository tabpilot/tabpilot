import type { TicketScore } from '@tabpilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
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

const PREFETCH_INTERVAL_MS = 800;

/**
 * Prefetch scores for all URLs in the session.
 * Tickets already scored in the API's MongoDB cache return instantly (no Gemini call).
 * New tickets are staggered to avoid Gemini rate limits.
 * Results land in React Query cache; TicketScoreBadge reads from cache without fetching.
 */
export function usePrefetchTicketScores(urls: string[]) {
  const qc = useQueryClient();
  const prefetchedRef = useRef(new Set<string>());

  useEffect(() => {
    const pending: Array<() => void> = [];

    for (const url of urls) {
      const info = parseJiraUrl(url);
      const cacheKey = info ? info.key : url;
      if (!cacheKey || prefetchedRef.current.has(cacheKey)) continue;
      prefetchedRef.current.add(cacheKey);

      if (info) {
        pending.push(() =>
          qc.prefetchQuery({
            queryKey: ['ticket-score', info.key],
            queryFn: () => fetchTicketScore(info.key, info.baseUrl),
            staleTime: Infinity,
          }),
        );
      } else {
        pending.push(() =>
          qc.prefetchQuery({
            queryKey: ['ticket-score', 'url', url],
            queryFn: () => fetchTicketScoreByUrl(url),
            staleTime: Infinity,
          }),
        );
      }
    }

    const timers = pending.map((fn, i) => setTimeout(fn, i * PREFETCH_INTERVAL_MS));
    return () => timers.forEach(clearTimeout);
  }, [urls, qc]);
}
