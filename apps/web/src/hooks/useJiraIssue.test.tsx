import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJiraIssueTeams } from './useJiraIssue';

vi.mock('@/lib/jira', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jira')>('@/lib/jira');
  return { ...actual, fetchJiraIssue: vi.fn() };
});

import { fetchJiraIssue } from '@/lib/jira';

const mockFetchJiraIssue = fetchJiraIssue as ReturnType<typeof vi.fn>;

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('useJiraIssueTeams', () => {
  beforeEach(() => {
    mockFetchJiraIssue.mockReset();
  });

  it('returns the team for a Jira URL and skips other URLs', async () => {
    mockFetchJiraIssue.mockResolvedValue({
      key: 'PROJ-1',
      summary: 'Fix bug',
      status: 'Open',
      issueType: 'Story',
      team: 'Platform',
    });

    const { result } = renderHook(
      () =>
        useJiraIssueTeams([
          'https://myorg.atlassian.net/browse/PROJ-1',
          'https://example.com/notes',
        ]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current[0]).toEqual({ team: 'Platform', isJira: true, isLoading: false });
    });
    expect(result.current[1]).toEqual({ team: null, isJira: false, isLoading: false });
    expect(mockFetchJiraIssue).toHaveBeenCalledTimes(1);
    expect(mockFetchJiraIssue).toHaveBeenCalledWith('PROJ-1', 'https://myorg.atlassian.net');
  });

  it('reports a Jira with no team as unassigned once loading finishes', async () => {
    mockFetchJiraIssue.mockResolvedValue({
      key: 'PROJ-2',
      summary: 'Untagged',
      status: 'Open',
      issueType: 'Story',
      team: null,
    });

    const { result } = renderHook(
      () => useJiraIssueTeams(['https://myorg.atlassian.net/browse/PROJ-2']),
      { wrapper: createWrapper() },
    );

    expect(result.current[0].isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current[0]).toEqual({ team: null, isJira: true, isLoading: false });
    });
  });
});
