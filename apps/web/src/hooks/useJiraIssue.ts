import { useQuery } from '@tanstack/react-query';
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
