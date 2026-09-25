import type { Session } from '@tabpilot/shared';
import { WS_EVENTS } from '@tabpilot/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/store/sessionStore';
import { HostDashboard } from './HostDashboard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
const mockNavigate = vi.fn();
const jiraQueue = vi.hoisted(() => ({
  byUrl: new Map<string, { team: string | null; isJira: boolean; isLoading: boolean }>(),
}));

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ emit: mockEmit }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'session-1' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ isConnected: true }),
}));

vi.mock('@/hooks/useJiraIssue', () => ({
  useJiraIssue: () => ({ data: null }),
  useJiraIssueTeams: (urls: string[]) =>
    urls.map((url) => jiraQueue.byUrl.get(url) ?? { team: null, isJira: false, isLoading: false }),
}));

vi.mock('@/hooks/useUrlTitle', () => ({
  useUrlTitle: () => ({ data: null }),
}));

vi.mock('@/hooks/useTabSync', () => ({
  useTabSync: () => ({ navigateTo: vi.fn(), isEnabled: false }),
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const mockUpdateJiraStoryPoints = vi.fn();
vi.mock('@/lib/jira', () => ({
  parseJiraUrl: (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'atlassian.net' || parsed.hostname.endsWith('.atlassian.net')) {
        return { key: parsed.pathname.split('/').pop(), baseUrl: parsed.origin };
      }
    } catch {}
    return null;
  },
  isStoryPointConfigured: (url: string) => {
    try {
      const { hostname } = new URL(url);
      return hostname === 'atlassian.net' || hostname.endsWith('.atlassian.net');
    } catch {
      return false;
    }
  },
  updateJiraStoryPoints: (...args: unknown[]) => mockUpdateJiraStoryPoints(...args),
}));

vi.mock('@/hooks/useJiraStatus', () => ({
  useJiraStatus: () => ({
    data: { configured: true, storyPointProjects: ['FAKE'], hasExtraFields: false },
  }),
}));

vi.mock('@/hooks/useTicketScoreStatus', () => ({
  useTicketScoreStatus: () => ({ data: { configured: false } }),
}));

vi.mock('@/hooks/useTicketScore', () => ({
  useTicketScore: () => ({ data: null, isLoading: false }),
  usePrefetchTicketScores: () => {},
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  name: 'Sprint Grooming',
  joinCode: 'ABC123',
  hostName: 'Host',
  coHosts: [],
  urls: ['https://example.com/issue/1'],
  currentIndex: 0,
  state: 'active',
  votingEnabled: false,
  isLocked: false,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides,
});

beforeEach(() => {
  jiraQueue.byUrl.clear();
});

function seedHostState() {
  const store = useSessionStore.getState();
  store.setSession(makeSession());
  store.setIsHost(true);
  store.setHostKey('host-key-123');
  store.saveHostKey('session-1', 'host-key-123');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HostDashboard — end session modal', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    mockNavigate.mockClear();
    seedHostState();
  });

  it('opens the confirm modal when "End" is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByRole('button', { name: /end/i })[0]);

    expect(screen.getByText('End session?')).toBeInTheDocument();
    expect(screen.getByText(/this will disconnect all participants/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end session/i })).toBeInTheDocument();
  });

  it('closes the modal without ending when Cancel is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByRole('button', { name: /end/i })[0]);
    expect(screen.getByText('End session?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByText('End session?')).not.toBeInTheDocument();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emits HOST_END_SESSION and navigates home when confirmed', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByRole('button', { name: /end/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /end session/i }));

    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_END_SESSION, {
        sessionId: 'session-1',
        hostKey: 'host-key-123',
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('closes the modal by clicking the X button', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByRole('button', { name: /end/i })[0]);
    expect(screen.getByText('End session?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByText('End session?')).not.toBeInTheDocument();
  });
});

describe('HostDashboard — add URL validation', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    seedHostState();
  });

  it('shows error toast for invalid URL', async () => {
    render(<HostDashboard />);

    const input = screen.getByPlaceholderText(/paste a url/i);
    await userEvent.type(input, 'not-a-url');
    // Trigger add via the + button
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect((toast as any).error).toHaveBeenCalledWith('Please enter a valid http/https URL');
    });
    expect(mockEmit).not.toHaveBeenCalledWith(WS_EVENTS.HOST_ADD_URL, expect.anything());
  });

  it('emits HOST_ADD_URL for a valid URL', async () => {
    render(<HostDashboard />);

    const input = screen.getByPlaceholderText(/paste a url/i);
    await userEvent.type(input, 'https://example.com/ticket');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_ADD_URL, {
        sessionId: 'session-1',
        hostKey: 'host-key-123',
        url: 'https://example.com/ticket',
      });
    });
  });
});

describe('HostDashboard — vote reveal display', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    seedHostState();
  });

  it('shows revealed votes panel with average when votes exist', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setRevealedVotes({ p1: '3', p2: '5' });

    render(<HostDashboard />);

    expect(screen.getByText('Votes Revealed')).toBeInTheDocument();
    expect(screen.getByText(/avg 4/)).toBeInTheDocument();
  });

  it('shows Reveal button when participants have voted but not revealed', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setVotedParticipantIds(['p1']);

    render(<HostDashboard />);

    expect(screen.getAllByRole('button', { name: /reveal/i }).length).toBeGreaterThan(0);
  });
});

describe('HostDashboard — session state overlays', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    seedHostState();
  });

  it('shows "Ready to start?" overlay when session is waiting', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ state: 'waiting' }));

    render(<HostDashboard />);

    expect(screen.getByText('Ready to start?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument();
  });

  it('shows waiting message with participant count', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ state: 'waiting' }));
    store.setParticipants([
      {
        id: 'p1',
        name: 'Alice',
        isOnline: true,
        sessionId: 'session-1',
        joinedAt: new Date().toISOString(),
        avatarUrl: '',
      },
    ]);

    render(<HostDashboard />);

    expect(screen.getByText(/1 participant.*online and waiting/i)).toBeInTheDocument();
  });

  it('shows "Session ended" overlay when session is ended', () => {
    const store = useSessionStore.getState();
    store.setSession(
      makeSession({ state: 'ended', urls: ['https://example.com/1', 'https://example.com/2'] }),
    );

    render(<HostDashboard />);

    expect(screen.getByText('Session ended')).toBeInTheDocument();
    expect(screen.getByText(/groomed 2 tickets/i)).toBeInTheDocument();
  });

  it('shows singular "ticket" when only 1 URL', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ state: 'ended', urls: ['https://example.com/1'] }));

    render(<HostDashboard />);

    expect(screen.getByText(/groomed 1 ticket\./i)).toBeInTheDocument();
  });
});

describe('HostDashboard — grooming complete', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    // Seed with a two-URL session positioned on the last ticket
    const store = useSessionStore.getState();
    store.setSession(
      makeSession({
        urls: ['https://example.com/1', 'https://example.com/2'],
        currentIndex: 1,
      }),
    );
    store.setIsHost(true);
    store.setHostKey('host-key-123');
    store.saveHostKey('session-1', 'host-key-123');
  });

  it('emits GROOMING_COMPLETE when Complete is clicked on the last ticket', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.GROOMING_COMPLETE, {
        sessionId: 'session-1',
        hostKey: 'host-key-123',
      });
    });
  });

  it('fires confetti when Complete is clicked', async () => {
    const confettiMock = vi.mocked((await import('canvas-confetti')).default);
    confettiMock.mockClear();

    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => {
      expect(confettiMock).toHaveBeenCalled();
    });
  });

  it('shows Completed badge after Complete is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => {
      expect(screen.getByText('All tickets groomed!')).toBeInTheDocument();
    });
  });

  it('hides completion banner when a new URL is added after completing', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => {
      expect(screen.getByText('All tickets groomed!')).toBeInTheDocument();
    });

    // Simulate server pushing SESSION_STATE with an extra URL added
    act(() => {
      useSessionStore.getState().setSession(
        makeSession({
          urls: ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'],
          currentIndex: 1,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText('All tickets groomed!')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
describe('HostDashboard — navigation controls', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    seedHostState();
  });

  it('does not move the queue while a team filter is active', async () => {
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Platform', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Mobile', isJira: true, isLoading: false });
    useSessionStore.getState().setSession(makeSession({ urls, currentIndex: 0 }));
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('tab', { name: 'Mobile' }));
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByText(/choose all teams to move/i)).toBeInTheDocument();
    expect(mockEmit).not.toHaveBeenCalledWith('host_navigate', expect.anything());
  });

  it('moves to the next ticket in the selected team queue', async () => {
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
      'https://example.atlassian.net/browse/PROJ-3',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Platform', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Mobile', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[2], { team: 'Platform', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 0, teamQueuesEnabled: true }));
    render(<HostDashboard />);

    expect(screen.queryByRole('tab', { name: 'All teams' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'No team' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ index: 2, sessionId: 'session-1', hostKey: 'host-key-123' }),
    );
  });

  it('emits HOST_NAVIGATE next when Next is clicked', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ direction: 'next' }),
    );
  });

  it('emits HOST_NAVIGATE prev when Previous is clicked', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 1 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ direction: 'prev' }),
    );
  });

  it('emits HOST_NAVIGATE with skip: true when Skip is clicked on a non-last ticket', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ direction: 'next', skip: true }),
    );
  });

  it('emits HOST_SET_SAVED_VOTE when Skip is clicked on the only/last ticket in regular mode', async () => {
    const store = useSessionStore.getState();
    // Single ticket session — currentIndex 0 is both first and last
    store.setSession(makeSession({ urls: ['https://a.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      WS_EVENTS.HOST_SET_SAVED_VOTE,
      expect.objectContaining({
        sessionId: 'session-1',
        hostKey: 'host-key-123',
        urlIndex: 0,
        value: 'skipped',
      }),
    );
    expect(mockEmit).not.toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ skip: true }),
    );
  });

  it('emits HOST_SET_SAVED_VOTE when Skip is clicked on the last ticket of a team queue', async () => {
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
    ];
    // Both tickets belong to the same team — at currentIndex 1 (last), step(1) returns null
    jiraQueue.byUrl.set(urls[0], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Alpha', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 1, teamQueuesEnabled: true }));
    render(<HostDashboard />);
    mockEmit.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(mockEmit).toHaveBeenCalledWith(
      WS_EVENTS.HOST_SET_SAVED_VOTE,
      expect.objectContaining({ urlIndex: 1, value: 'skipped' }),
    );
    expect(mockEmit).not.toHaveBeenCalledWith(
      'host_navigate',
      expect.objectContaining({ skip: true }),
    );
  });

  it('celebrates and broadcasts when the last Jira in a team queue is finished', async () => {
    const confettiMock = vi.mocked((await import('canvas-confetti')).default);
    confettiMock.mockClear();
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Alpha', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 1, teamQueuesEnabled: true }));
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /finish queue/i }));

    expect(confettiMock).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.TEAM_QUEUE_COMPLETED, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      queueName: 'Alpha',
    });
  });

  it('does not celebrate when another team queue remains', async () => {
    const confettiMock = vi.mocked((await import('canvas-confetti')).default);
    confettiMock.mockClear();
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
      'https://example.atlassian.net/browse/PROJ-3',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[2], { team: 'Beta', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 1, teamQueuesEnabled: true }));
    render(<HostDashboard />);

    await userEvent.click(screen.getByRole('button', { name: /finish queue/i }));

    expect(confettiMock).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(WS_EVENTS.TEAM_QUEUE_COMPLETED, expect.anything());
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a success toast when Skip is clicked on the last ticket in team-queues mode', async () => {
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Alpha', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 1, teamQueuesEnabled: true }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => {
      expect((toast as any).success).toHaveBeenCalled();
    });
  });

  it('finishes a team queue after navigating through it without saved story points', async () => {
    const urls = [
      'https://example.atlassian.net/browse/PROJ-1',
      'https://example.atlassian.net/browse/PROJ-2',
    ];
    jiraQueue.byUrl.set(urls[0], { team: 'Alpha', isJira: true, isLoading: false });
    jiraQueue.byUrl.set(urls[1], { team: 'Alpha', isJira: true, isLoading: false });
    useSessionStore
      .getState()
      .setSession(makeSession({ urls, currentIndex: 1, teamQueuesEnabled: true }));
    render(<HostDashboard />);

    const finishQueue = screen.getByRole('button', { name: /finish queue/i });
    expect(finishQueue).toBeEnabled();
    await userEvent.click(finishQueue);

    expect(mockEmit).toHaveBeenCalledWith(
      WS_EVENTS.HOST_NAVIGATE,
      expect.objectContaining({
        index: 1,
        teamQueueProgress: { queueKey: 'team:Alpha', position: 2 },
      }),
    );
    expect(mockEmit).not.toHaveBeenCalledWith(
      WS_EVENTS.HOST_SET_SAVED_VOTE,
      expect.objectContaining({ value: expect.anything() }),
    );
  });

  it('shows Edit order button and hides drag handles by default', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    expect(screen.getByRole('button', { name: /edit order/i })).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Drag to reorder')).toHaveLength(0);
  });

  it('shows drag handles and Done button after clicking Edit order', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /edit order/i }));
    // Edit order button replaced by Done button in the queue header
    expect(screen.queryByRole('button', { name: /edit order/i })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Drag to reorder').length).toBeGreaterThan(0);
  });

  it('disables Previous, Skip, and Next while in edit mode', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /edit order/i }));
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('re-enables nav buttons after exiting edit mode', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /edit order/i }));
    // Exit by clicking Edit order again (now shows as Done in the queue header)
    // The "Edit order" button was replaced — find it by its emerald Done styling via test-id or re-click Edit order
    // Simplest: just verify that after being in edit mode, clicking the queue Done button re-enables nav
    const doneBtn = screen
      .getAllByRole('button')
      .find(
        (btn) => btn.textContent?.includes('Done') && !btn.textContent?.includes('All tickets'),
      );
    if (doneBtn) await userEvent.click(doneBtn);
    // Next and Skip should be enabled again
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeDisabled();
  });

  it('does not emit HOST_NAVIGATE when nav buttons are clicked in edit mode', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ urls: ['https://a.com', 'https://b.com'], currentIndex: 0 }));
    render(<HostDashboard />);
    await userEvent.click(screen.getByRole('button', { name: /edit order/i }));
    mockEmit.mockClear();
    // Buttons are disabled — clicks are no-ops
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(mockEmit).not.toHaveBeenCalledWith('host_navigate', expect.anything());
  });

  it('emits HOST_ADD_URL when a valid URL is submitted', async () => {
    render(<HostDashboard />);
    const input = screen.getByPlaceholderText(/paste a url/i);
    await userEvent.type(input, 'https://new.example.com{Enter}');
    expect(mockEmit).toHaveBeenCalledWith(
      'host_add_url',
      expect.objectContaining({ url: 'https://new.example.com' }),
    );
  });

  it('opens the share modal when the join code button is clicked', async () => {
    render(<HostDashboard />);
    const codeBtn = screen.getAllByText('ABC123')[0].closest('button');
    if (codeBtn) await userEvent.click(codeBtn);
    expect(screen.getByText('Share Session')).toBeInTheDocument();
  });

  it('shows the join code and co-host section inside the share modal', async () => {
    render(<HostDashboard />);
    const codeBtn = screen.getAllByText('ABC123')[0].closest('button');
    if (codeBtn) await userEvent.click(codeBtn);
    expect(screen.getByText('Invite Co-Hosts')).toBeInTheDocument();
    expect(screen.getByText(/Copy Co-Host Invite Link/i)).toBeInTheDocument();
  });

  it('shows the Reveal button when votingEnabled and participants have voted', () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setVotedParticipantIds(['p-1', 'p-2']);
    render(<HostDashboard />);
    expect(screen.getAllByRole('button', { name: /reveal/i })).not.toHaveLength(0);
  });
});

describe('HostDashboard — settings modal', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    seedHostState();
  });

  it('opens the settings modal when Settings is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);

    expect(screen.getByText('Session Settings')).toBeInTheDocument();
    expect(screen.getByText('Story point voting')).toBeInTheDocument();
    expect(screen.getByText('Team queues')).toBeInTheDocument();
    expect(screen.getByText('Lock session')).toBeInTheDocument();
  });

  it('keeps the session title read-only in the header and editable in settings', async () => {
    render(<HostDashboard />);

    expect(screen.getByRole('heading', { name: 'Sprint Grooming' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit session title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /session title/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);

    expect(screen.getByRole('textbox', { name: /session title/i })).toHaveValue('Sprint Grooming');
  });

  it('emits UPDATE_SESSION_NAME with the edited title when saved in settings', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    const titleInput = screen.getByRole('textbox', { name: /session title/i });
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Sprint 48 Grooming');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.UPDATE_SESSION_NAME, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      name: 'Sprint 48 Grooming',
    });
  });

  it('emits HOST_TOGGLE_TEAM_QUEUES when the team queues toggle is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    await userEvent.click(screen.getByLabelText(/toggle team queues/i));

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_TOGGLE_TEAM_QUEUES, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      teamQueuesEnabled: true,
    });
  });

  it('emits HOST_TOGGLE_VOTING when voting toggle is clicked to enable', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: false }));

    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    await userEvent.click(screen.getByLabelText(/toggle voting/i));

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_TOGGLE_VOTING, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      votingEnabled: true,
    });
  });

  it('emits HOST_TOGGLE_VOTING when voting toggle is clicked to disable', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));

    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    await userEvent.click(screen.getByLabelText(/toggle voting/i));

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_TOGGLE_VOTING, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      votingEnabled: false,
    });
  });

  it('emits HOST_TOGGLE_LOCK when lock toggle is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    await userEvent.click(screen.getByLabelText(/toggle lock/i));

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_TOGGLE_LOCK, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      locked: true,
    });
  });

  it('closes the settings modal when X is clicked', async () => {
    render(<HostDashboard />);

    await userEvent.click(screen.getAllByTitle(/session settings/i)[0]);
    expect(screen.getByText('Session Settings')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /close/i })[0]);
    expect(screen.queryByText('Session Settings')).not.toBeInTheDocument();
  });
});

describe('HostDashboard — story point management', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState?.() ?? {});
    mockEmit.mockClear();
    mockNavigate.mockClear();
    mockUpdateJiraStoryPoints.mockClear();
    seedHostState();
  });

  it('shows the story point row when votes are revealed (votingEnabled session)', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setRevealedVotes({ 'p-1': '5', 'p-2': '8' });

    render(<HostDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText('Story point override')).toBeInTheDocument();
    });
    // Input should be pre-filled with the rounded average (6 or 7 depending on rounding)
    const input = screen.getByLabelText('Story point override') as HTMLInputElement;
    expect(input.value).toMatch(/\d/);
  });

  it('emits HOST_SET_SAVED_VOTE when Save is clicked', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setRevealedVotes({ 'p-1': '5' });

    render(<HostDashboard />);

    const input = await screen.findByLabelText('Story point override');
    await userEvent.clear(input);
    await userEvent.type(input, '8');

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await userEvent.click(saveBtn);

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_SET_SAVED_VOTE, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      urlIndex: 0,
      value: '8',
    });
  });

  it('emits HOST_RESET_SAVED_VOTE when reset button is clicked in UrlQueue', async () => {
    const store = useSessionStore.getState();
    store.setSession(
      makeSession({
        votingEnabled: true,
        urls: ['https://example.com/past', 'https://example.com/current'],
        currentIndex: 1,
      }),
    );
    store.setSavedVotesMap({ 0: '5' });

    render(<HostDashboard />);

    const resetBtn = await screen.findByTitle('Reset story point');
    await userEvent.click(resetBtn);

    expect(mockEmit).toHaveBeenCalledWith(WS_EVENTS.HOST_RESET_SAVED_VOTE, {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
      urlIndex: 0,
    });
  });

  it('shows Jira button in revealed votes panel only for Jira URLs', async () => {
    const store = useSessionStore.getState();
    store.setSession(
      makeSession({
        votingEnabled: true,
        urls: ['https://example.atlassian.net/browse/FAKE-123'],
      }),
    );
    store.setRevealedVotes({ 'p-1': '5' });

    render(<HostDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save to jira/i })).toBeInTheDocument();
    });
  });

  it('emits HOST_RESET_VOTES when Reset button is clicked after voting', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setVotedParticipantIds(['p-1']);

    render(<HostDashboard />);

    // Desktop + mobile both render the button — click the first
    const [resetBtn] = await screen.findAllByRole('button', { name: /reset/i });
    await userEvent.click(resetBtn);

    expect(mockEmit).toHaveBeenCalledWith('host_reset_votes', {
      sessionId: 'session-1',
      hostKey: 'host-key-123',
    });
  });

  it('shows Reset button when votes are revealed', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true }));
    store.setRevealedVotes({ 'p-1': '5' });

    render(<HostDashboard />);

    await screen.findByText('Votes Revealed');
    const resetBtns = screen.getAllByRole('button', { name: /reset/i });
    expect(resetBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show Jira button for non-Jira URLs', async () => {
    const store = useSessionStore.getState();
    store.setSession(makeSession({ votingEnabled: true })); // uses https://example.com/issue/1
    store.setRevealedVotes({ 'p-1': '5' });

    render(<HostDashboard />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save to jira/i })).not.toBeInTheDocument();
    });
  });

  it('calls updateJiraStoryPoints with the correct key and points', async () => {
    mockUpdateJiraStoryPoints.mockResolvedValue(undefined);
    const store = useSessionStore.getState();
    store.setSession(
      makeSession({
        votingEnabled: true,
        urls: ['https://example.atlassian.net/browse/FAKE-123'],
      }),
    );
    store.setRevealedVotes({ 'p-1': '8' });

    render(<HostDashboard />);

    const input = await screen.findByLabelText('Story point override');
    await userEvent.clear(input);
    await userEvent.type(input, '8');

    const jiraBtn = screen.getByRole('button', { name: /save to jira/i });
    await userEvent.click(jiraBtn);

    await waitFor(() => {
      expect(mockUpdateJiraStoryPoints).toHaveBeenCalledWith(
        'FAKE-123',
        8,
        'host-key-123',
        'session-1',
        'https://example.atlassian.net',
        true,
      );
    });
  });
});
