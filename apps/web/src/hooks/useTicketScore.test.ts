import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

vi.mock('@/lib/jira', () => ({
  parseJiraUrl: vi.fn(),
}));

import apiClient from '@/lib/api';
import { parseJiraUrl } from '@/lib/jira';
import { usePrefetchTicketScores, useTicketScore } from './useTicketScore';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockParseJiraUrl = parseJiraUrl as ReturnType<typeof vi.fn>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useTicketScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches via /ticket-score/url for non-Jira URLs', async () => {
    mockParseJiraUrl.mockReturnValue(null);
    const score = { overall: 65, dimensions: {} };
    mockGet.mockResolvedValue({ data: score });

    const { result } = renderHook(
      () => useTicketScore('https://github.com/expressjs/express/issues/7350'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(score);
    expect(mockGet).toHaveBeenCalledWith('/ticket-score/url', {
      params: { url: 'https://github.com/expressjs/express/issues/7350' },
    });
  });

  it('is disabled when url is empty', () => {
    mockParseJiraUrl.mockReturnValue(null);
    const { result } = renderHook(() => useTicketScore(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches score when URL is a valid Jira URL', async () => {
    mockParseJiraUrl.mockReturnValue({ key: 'PROJ-1', baseUrl: 'https://myorg.atlassian.net' });
    const score = { overall: 80, dimensions: {} };
    mockGet.mockResolvedValue({ data: score });

    const { result } = renderHook(
      () => useTicketScore('https://myorg.atlassian.net/browse/PROJ-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(score);
    expect(mockGet).toHaveBeenCalledWith('/ticket-score/PROJ-1', {
      params: { baseUrl: 'https://myorg.atlassian.net' },
    });
  });

  it('does not retry on error', async () => {
    mockParseJiraUrl.mockReturnValue({ key: 'PROJ-2', baseUrl: undefined });
    mockGet.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(
      () => useTicketScore('https://myorg.atlassian.net/browse/PROJ-2'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('usePrefetchTicketScores', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op — scores arrive via TICKET_SCORE_UPDATE WebSocket event', () => {
    const { result } = renderHook(() => usePrefetchTicketScores(['https://example.com']), {
      wrapper: createWrapper(),
    });
    expect(result.current).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
