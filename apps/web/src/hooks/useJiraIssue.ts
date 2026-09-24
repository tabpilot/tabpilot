import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchJiraIssue, parseJiraUrl } from '@/lib/jira';

/**
 * Fetches a Jira issue title for the given URL.
 * Returns null data (no error shown) when the URL is not a Jira URL or
 * when the server has Jira integration disabled.
 */
export function useJiraIssue(url: string, disableFetch = false) {
  const info = parseJiraUrl(url);

  return useQuery({
    queryKey: ['jira', 'issue', info?.key ?? ''],
    queryFn: () => fetchJiraIssue(info?.key ?? '', info?.baseUrl),
    enabled: !!info && !disableFetch,
    staleTime: 10 * 60 * 1000, // 10 min — issue titles rarely change mid-session
    retry: false, // don't retry — missing config or wrong key should fail fast
    throwOnError: false,
  });
}

export interface QueueTicketTeam {
  team: string | null;
  isJira: boolean;
  isLoading: boolean;
}

/** Team name for each queue URL, sharing the issue cache used by useJiraIssue. */
export function useJiraIssueTeams(urls: string[]): QueueTicketTeam[] {
  const queries = useQueries({
    queries: urls.map((url) => {
      const info = parseJiraUrl(url);
      return {
        queryKey: ['jira', 'issue', info?.key ?? ''],
        queryFn: () => fetchJiraIssue(info?.key ?? '', info?.baseUrl),
        enabled: !!info,
        staleTime: 10 * 60 * 1000,
        retry: false,
      };
    }),
  });

  return urls.map((url, index) => {
    const info = parseJiraUrl(url);
    const query = queries[index];
    return {
      team: query?.data?.team?.trim() || null,
      isJira: !!info,
      isLoading: !!info && (query?.isLoading ?? false),
    };
  });
}
