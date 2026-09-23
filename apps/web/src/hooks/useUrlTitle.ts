import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { parseJiraUrl } from '@/lib/jira';

async function fetchUrlTitle(url: string): Promise<string | null> {
  const res = await apiClient.get<{ title: string | null }>('/meta/title', {
    params: { url },
  });
  return res.data.title;
}

/**
 * Fetches the <title> of any URL via the backend proxy.
 * Skipped for Jira URLs (those are handled by useJiraIssue instead).
 */
export function useUrlTitle(url: string, disableFetch = false) {
  const isJira = !!parseJiraUrl(url);

  return useQuery({
    queryKey: ['meta', 'title', url],
    queryFn: () => fetchUrlTitle(url),
    enabled: !!url && !isJira && !disableFetch,
    staleTime: 30 * 60 * 1000, // 30 min — page titles are stable
    retry: false,
    throwOnError: false,
  });
}
